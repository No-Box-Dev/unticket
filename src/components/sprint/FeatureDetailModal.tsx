import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { X, ExternalLink, Pencil } from "lucide-react";
import { AssignDropdown } from "./AssignDropdown";
import { SpecLinksSection } from "@/components/specs/SpecLinksSection";
import { FeatureLinkedSpecsSection } from "./FeatureLinkedSpecsSection";
import { withStatusTransition } from "@/lib/github-features";
import { useBoardStages } from "@/lib/board-stages";
import type { BoardStage, Feature, FeatureStatus } from "@/lib/types";

// Look up the label/color for a feature's current status. Legacy statuses that
// no longer match any configured stage (e.g. `status:future` after an admin
// removed that stage) fall through to a neutral grey + the raw id so history
// entries from before the rename still render legibly.
function stageLookup(stages: BoardStage[], id: FeatureStatus): { label: string; color: string } {
  const stage = stages.find((s) => s.id === id);
  if (stage) return { label: stage.label, color: stage.color };
  return { label: id || "—", color: "#94a3b8" };
}

// ---------- Component ----------

interface FeatureDetailModalProps {
  feature: Feature;
  allPeople: string[];
  onClose: () => void;
  onUpdate: (updated: Feature) => void;
}

export function FeatureDetailModal({ feature, allPeople, onClose, onUpdate }: FeatureDetailModalProps) {
  const [draft, setDraft] = useState<Feature>({ ...feature });
  const stages = useBoardStages();
  // Status options include the current value even if it no longer matches a
  // configured stage, so admins can always pick a valid replacement.
  const statusOptions = useMemo<BoardStage[]>(() => {
    if (stages.some((s) => s.id === draft.status)) return stages;
    return [...stages, { id: draft.status, label: draft.status || "—", color: "#94a3b8" }];
  }, [stages, draft.status]);
  const currentStage = stageLookup(stages, draft.status);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hasUnsavedChanges = useRef(false);

  const save = useCallback((next: Feature) => {
    hasUnsavedChanges.current = false;
    onUpdate({ ...next });
  }, [onUpdate]);

  const saveDebounced = useCallback((next: Feature) => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => save(next), 500);
  }, [save]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  // Re-sync from parent when the source feature refetches and there are
  // no unsaved local edits. Without this, a webhook or cron refetch mid-
  // view would leave the modal showing the stale snapshot the user first
  // opened — and any subsequent Save would silently revert whoever
  // changed the row in the meantime. Guarded on hasUnsavedChanges so we
  // don't stomp the user's in-progress edit; if they have local changes,
  // let their next Save win instead of clobbering the draft.
  //
  // Fingerprint the identifying fields so we don't re-fire on every parent
  // re-render — only when something the modal actually reads changes.
  const featureFingerprint =
    `${feature.id}|${feature.title}|${feature.status}|${!!feature.backlog}|` +
    `${feature.updatedAt ?? ""}|${(feature.owners ?? []).join(",")}|` +
    `${feature.specLinks?.length ?? 0}`;
  useEffect(() => {
    if (hasUnsavedChanges.current) return;
    setDraft({ ...feature });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureFingerprint]);

  function update(patch: Partial<Feature>, debounce = false) {
    setDraft((d) => {
      const next = { ...d, ...patch };
      hasUnsavedChanges.current = true;
      if (debounce) {
        saveDebounced(next);
      } else {
        clearTimeout(debounceRef.current);
        save(next);
      }
      return next;
    });
  }

  function handleClose() {
    // Flush any pending debounced save, but only if there are unsaved changes
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
      if (hasUnsavedChanges.current) {
        onUpdate({ ...draft });
        hasUnsavedChanges.current = false;
      }
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <div className="group/title flex items-center gap-2 flex-1 min-w-0">
            <input
              value={draft.title}
              onChange={(e) => update({ title: e.target.value }, true)}
              className="text-lg font-semibold text-stone-800 bg-transparent w-full rounded px-2 py-1 -mx-2 border border-transparent hover:border-stone-200 focus:border-accent/40 focus:ring-2 focus:ring-accent/20 outline-none transition-all"
              title="Click to edit title"
            />
            <Pencil size={14} className="shrink-0 text-stone-300 group-hover/title:text-stone-400 transition-colors" />
            {draft.url && (
              <a
                href={draft.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View issue on GitHub"
                className="shrink-0 text-stone-400 hover:text-accent flex items-center gap-1 text-xs"
                title="View issue on GitHub"
              >
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            )}
          </div>
          <button onClick={handleClose} className="text-stone-400 hover:text-stone-600 cursor-pointer ml-2">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-5">
          {/* Meta row */}
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <span className="text-xs text-stone-500 block mb-1">Status</span>
              <select
                value={draft.status}
                onChange={(e) => {
                  const next = withStatusTransition(draft, e.target.value as FeatureStatus);
                  setDraft(next);
                  hasUnsavedChanges.current = true;
                  save(next);
                }}
                className="px-2.5 py-1.5 rounded-md border border-stone-200 bg-white text-xs text-stone-700 focus:outline-none focus:border-accent cursor-pointer"
              >
                {statusOptions.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <span className="text-xs text-stone-500 block mb-1">Owners</span>
              <AssignDropdown
                owners={draft.owners}
                allPeople={allPeople}
                onChange={(owners) => update({ owners })}
              />
            </div>
          </div>

          {/* All rich content on a feature lives in its Specs — a feature
              no longer has its own description/plan field. The Specs
              section is the only content surface. */}
          <FeatureLinkedSpecsSection featureNumber={draft.id} featureTitle={draft.title} />

          {/* Spec links (free external URLs — Figma / Notion / etc.) */}
          <SpecLinksSection
            value={draft.specLinks ?? []}
            onChange={(links) => update({ specLinks: links }, true)}
          />

          {/* Status History Timeline */}
          {draft.statusHistory && draft.statusHistory.length > 0 && (
            <div>
              <span className="text-xs text-stone-500 block mb-2">History</span>
              <div className="relative pl-4 space-y-2">
                <div className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-stone-200" />
                {draft.statusHistory.map((entry, i) => {
                  const { label, color } = stageLookup(stages, entry.status);
                  const date = new Date(entry.timestamp);
                  const ago = formatTimeAgo(date);
                  return (
                    <div key={i} className="relative flex items-center gap-2">
                      <div
                        className="absolute -left-4 w-2.5 h-2.5 rounded-full ring-2 ring-white"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-xs font-medium text-stone-700">{label}</span>
                      <span className="text-xs text-stone-400">
                        {date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                        {date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                      </span>
                      <span className="text-xs text-stone-300">{ago}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Status footer */}
          <div className="flex items-center gap-2 text-xs text-stone-400 pt-1">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: currentStage.color }}
            />
            {currentStage.label}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Time Ago ----------

function formatTimeAgo(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

