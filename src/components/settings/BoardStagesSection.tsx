import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Loader2, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/hooks/useConfigRepo";
import { apiFetch } from "@/lib/api";
import {
  DEFAULT_BOARD_STAGES,
  MAX_BOARD_STAGES,
  MIN_BOARD_STAGES,
  isValidStageColor,
  isValidStageId,
  resolveBoardStages,
  slugifyStageId,
} from "@/lib/board-stages";
import type { BoardStage } from "@/lib/types";

type Orphan = { number: number; title: string; status: string };

// Row shape used for editing: tracks whether the id is still editable. Once a
// stage is saved, its id is locked because changing it would orphan features
// (the id is the GitHub label suffix). New rows let admins pick an id; saved
// rows show it as read-only.
type StageRow = BoardStage & { isNew?: boolean };

function stagesEqual(a: BoardStage[], b: BoardStage[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.id === b[i].id && s.label === b[i].label && s.color === b[i].color);
}

export function BoardStagesSection() {
  const qc = useQueryClient();
  const { selectedOrg } = useAuth();
  const { data: settings, isLoading } = useSettings();
  const savedStages = useMemo(() => resolveBoardStages(settings ?? null), [settings]);

  const [rows, setRows] = useState<StageRow[]>(savedStages);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orphans, setOrphans] = useState<Orphan[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Keep the editor in sync when the server-side settings change (e.g. cache
  // refetch). Skip while the user is mid-edit — we only reset when the saved
  // stages actually differ from what's currently editable AND nothing is dirty.
  useEffect(() => {
    setRows((prev) => (stagesEqual(prev, savedStages) ? prev : savedStages));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedStages.map((s) => `${s.id}:${s.label}:${s.color}`).join("|")]);

  const dirty = !stagesEqual(rows, savedStages);

  function update(idx: number, patch: Partial<StageRow>) {
    setRows((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
    setError(null);
    setOrphans([]);
  }

  function move(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= rows.length) return;
    setRows((prev) => {
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
    setError(null);
    setOrphans([]);
  }

  function remove(idx: number) {
    if (rows.length <= MIN_BOARD_STAGES) return;
    setRows((prev) => prev.filter((_, i) => i !== idx));
    setError(null);
    setOrphans([]);
  }

  function add() {
    if (rows.length >= MAX_BOARD_STAGES) return;
    const baseLabel = "New stage";
    const ids = new Set(rows.map((s) => s.id));
    let id = slugifyStageId(baseLabel);
    let i = 1;
    while (ids.has(id)) id = `${slugifyStageId(baseLabel)}-${++i}`;
    setRows((prev) => [...prev, { id, label: baseLabel, color: "#94a3b8", isNew: true }]);
    setError(null);
    setOrphans([]);
  }

  function reset() {
    setRows(savedStages);
    setError(null);
    setOrphans([]);
  }

  function loadDefaults() {
    setRows(DEFAULT_BOARD_STAGES);
    setError(null);
    setOrphans([]);
  }

  function validateLocal(): string | null {
    if (rows.length < MIN_BOARD_STAGES) return `At least ${MIN_BOARD_STAGES} stage is required.`;
    if (rows.length > MAX_BOARD_STAGES) return `At most ${MAX_BOARD_STAGES} stages allowed.`;
    const seen = new Set<string>();
    for (const s of rows) {
      if (!isValidStageId(s.id)) {
        return `Invalid id "${s.id}" — use lowercase letters, digits, hyphens (max 32 chars).`;
      }
      if (seen.has(s.id)) return `Duplicate stage id: ${s.id}`;
      seen.add(s.id);
      if (!s.label.trim() || s.label.length > 50) {
        return `Stage "${s.id}" needs a label (max 50 chars).`;
      }
      if (!isValidStageColor(s.color)) {
        return `Stage "${s.id}" has an invalid color (expected #RRGGBB).`;
      }
    }
    return null;
  }

  async function handleSave() {
    setError(null);
    setOrphans([]);
    setSavedAt(null);
    const localErr = validateLocal();
    if (localErr) {
      setError(localErr);
      return;
    }
    setBusy(true);
    try {
      // Strip the editor-only `isNew` flag before sending — server validation
      // only knows about {id, label, color}.
      const cleanStages: BoardStage[] = rows.map(({ id, label, color }) => ({
        id,
        label: label.trim(),
        color: color.toLowerCase(),
      }));
      const nextSettings = { ...(settings ?? {}), boardStages: cleanStages };
      const res = await apiFetch("/api/config/settings", {
        method: "PUT",
        body: JSON.stringify(nextSettings),
      });
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; orphans?: Orphan[] };
        setError(body.error ?? "Cannot remove stages that still contain features.");
        setOrphans(body.orphans ?? []);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Save failed (${res.status})`);
        return;
      }
      setSavedAt(Date.now());
      qc.setQueryData(["settings", selectedOrg], nextSettings);
      qc.invalidateQueries({ queryKey: ["settings", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["features", selectedOrg] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-3">
      <h2 className="text-sm font-semibold text-stone-900">Board stages</h2>
      <p className="text-xs text-stone-400">
        Rename, recolor, and reorder the kanban columns for this org ({MIN_BOARD_STAGES}–{MAX_BOARD_STAGES}{" "}
        stages). The leftmost stage is where new features land; the rightmost is
        what "Clean done" targets. You can't delete a stage that still contains
        open features — move them first.
      </p>

      {isLoading ? (
        <div className="text-xs text-stone-400 inline-flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <ul className="divide-y divide-stone-100 border border-stone-200 rounded-lg overflow-hidden">
            {rows.map((stage, idx) => (
              <li key={`${stage.id}-${idx}`} className="flex items-center gap-2 p-2.5 hover:bg-stone-50">
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0 || busy}
                    aria-label={`Move ${stage.label} up`}
                    className="p-0.5 text-stone-400 hover:text-stone-700 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                  >
                    <ArrowUp size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(idx, 1)}
                    disabled={idx === rows.length - 1 || busy}
                    aria-label={`Move ${stage.label} down`}
                    className="p-0.5 text-stone-400 hover:text-stone-700 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                  >
                    <ArrowDown size={12} />
                  </button>
                </div>

                <input
                  type="color"
                  value={stage.color}
                  onChange={(e) => update(idx, { color: e.target.value })}
                  disabled={busy}
                  aria-label={`Color for ${stage.label}`}
                  className="w-7 h-7 rounded border border-stone-200 cursor-pointer disabled:cursor-default"
                />

                <input
                  type="text"
                  value={stage.label}
                  onChange={(e) => {
                    const label = e.target.value;
                    // For brand-new rows, keep the id in sync with the label
                    // until the admin manually edits the id — once saved, the
                    // id is frozen so existing labels on GitHub keep matching.
                    if (stage.isNew) {
                      const otherIds = new Set(rows.filter((_, i) => i !== idx).map((s) => s.id));
                      let nextId = slugifyStageId(label || "stage");
                      let n = 1;
                      while (otherIds.has(nextId)) nextId = `${slugifyStageId(label || "stage")}-${++n}`;
                      update(idx, { label, id: nextId });
                    } else {
                      update(idx, { label });
                    }
                  }}
                  disabled={busy}
                  maxLength={50}
                  placeholder="Stage label"
                  className="flex-1 min-w-0 px-2 py-1.5 rounded border border-stone-200 bg-white text-xs text-stone-700 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                />

                {stage.isNew ? (
                  <input
                    type="text"
                    value={stage.id}
                    onChange={(e) => update(idx, { id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 32) })}
                    disabled={busy}
                    aria-label="Stage id"
                    title="GitHub label suffix (status:<id>)"
                    className="w-32 px-2 py-1.5 rounded border border-stone-200 bg-white text-[11px] font-mono text-stone-600 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                  />
                ) : (
                  <span
                    title="Stage id (locked — it's the GitHub label suffix)"
                    className="w-32 px-2 py-1.5 rounded bg-stone-100 text-[11px] font-mono text-stone-500 truncate"
                  >
                    {stage.id}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => remove(idx)}
                  disabled={busy || rows.length <= MIN_BOARD_STAGES}
                  aria-label={`Remove ${stage.label}`}
                  className="p-1.5 text-stone-300 hover:text-red-500 cursor-pointer rounded hover:bg-red-50 disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-stone-300"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={add}
              disabled={busy || rows.length >= MAX_BOARD_STAGES}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50 cursor-pointer"
            >
              <Plus size={12} /> Add stage
            </button>
            <button
              type="button"
              onClick={loadDefaults}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-xs font-medium text-stone-500 hover:bg-stone-50 disabled:opacity-50 cursor-pointer"
              title="Replace with the built-in 5-column scheme"
            >
              <RotateCcw size={12} /> Reset to defaults
            </button>
            <div className="flex-1" />
            {dirty && !busy && (
              <button
                type="button"
                onClick={reset}
                className="text-xs text-stone-500 hover:text-stone-700 cursor-pointer"
              >
                Discard
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || !dirty}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>

          {savedAt && !error && !dirty && (
            <p className="text-xs text-green-600">Saved.</p>
          )}
          {error && (
            <div className="space-y-1">
              <p className="text-xs text-red-500">{error}</p>
              {orphans.length > 0 && (
                <ul className="text-xs text-stone-600 list-disc pl-5 space-y-0.5">
                  {orphans.map((o) => (
                    <li key={o.number}>
                      <span className="font-mono text-stone-500">#{o.number}</span>{" "}
                      {o.title}{" "}
                      <span className="text-stone-400">— still in</span>{" "}
                      <span className="font-mono">{o.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
