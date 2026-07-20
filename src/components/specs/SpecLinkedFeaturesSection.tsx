import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Rocket, Search, X } from "lucide-react";
import { useFeatures, useCreateFeature, useUpdateFeature } from "@/hooks/useConfigRepo";
import { useBoardStages } from "@/lib/board-stages";
import type { BoardStage, Feature } from "@/lib/types";

interface Props {
  specId: number;
}

// Renders the "Linked features" section inside SpecDetailModal.
// The Feature side (see FeatureLinkedSpecsSection) owns the canonical
// storage — Feature.linkedSpecIds holds the ids. This section does the
// reverse lookup (features whose linkedSpecIds contains our specId) so we
// don't need a schema change or a sync tax. Add/remove goes through
// updateFeature to patch the target feature's list; that mutation
// invalidates the features cache, which refreshes this view.
export function SpecLinkedFeaturesSection({ specId }: Props) {
  const { data: features } = useFeatures();
  const stages = useBoardStages();
  const updateMut = useUpdateFeature();

  const [pickerOpen, setPickerOpen] = useState(false);

  const linkedFeatures = useMemo<Feature[]>(() => {
    return (features ?? []).filter((f) => f.linkedSpecIds?.includes(specId));
  }, [features, specId]);

  function removeFeatureLink(feature: Feature) {
    const next = (feature.linkedSpecIds ?? []).filter((id) => id !== specId);
    updateMut.mutate({ ...feature, linkedSpecIds: next });
  }

  function addFeatureLink(feature: Feature) {
    if ((feature.linkedSpecIds ?? []).includes(specId)) return;
    const next = [...(feature.linkedSpecIds ?? []), specId];
    updateMut.mutate({ ...feature, linkedSpecIds: next });
  }

  return (
    <div>
      <span className="text-xs text-stone-500 block mb-1.5">Linked features</span>
      {linkedFeatures.length === 0 ? (
        <p className="text-xs text-stone-400 italic mb-2">
          No features linked yet.
        </p>
      ) : (
        <ul className="space-y-1.5 mb-2">
          {linkedFeatures.map((f) => (
            <FeatureChip
              key={f.id}
              feature={f}
              stages={stages}
              onRemove={() => removeFeatureLink(f)}
            />
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-accent cursor-pointer"
      >
        <Plus size={12} /> Link feature
      </button>

      {pickerOpen && (
        <FeaturePickerModal
          allFeatures={features ?? []}
          linkedIds={new Set(linkedFeatures.map((f) => f.id))}
          stages={stages}
          specId={specId}
          onPick={(f) => {
            addFeatureLink(f);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

interface FeatureChipProps {
  feature: Feature;
  stages: BoardStage[];
  onRemove: () => void;
}

function FeatureChip({ feature, stages, onRemove }: FeatureChipProps) {
  const stage = stages.find((s) => s.id === feature.status);
  const label = stage?.label ?? feature.status ?? "—";
  const color = stage?.color ?? "#94a3b8";
  return (
    <li className="flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1.5">
      <Rocket size={12} className="shrink-0 text-stone-400" />
      <a
        href={`/?tab=sprint&f=${feature.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 truncate text-xs text-stone-700 hover:text-accent"
        title={feature.title}
      >
        {feature.title || <span className="text-stone-400">Untitled</span>}
      </a>
      <span
        className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] uppercase tracking-wider text-stone-500 border border-stone-200"
        title={`Status: ${label}`}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="text-stone-300 hover:text-red-500 cursor-pointer"
        title="Unlink"
        aria-label={`Unlink feature ${feature.title}`}
      >
        <X size={12} />
      </button>
    </li>
  );
}

interface FeaturePickerModalProps {
  allFeatures: Feature[];
  linkedIds: Set<number>;
  stages: BoardStage[];
  specId: number;
  onPick: (feature: Feature) => void;
  onClose: () => void;
}

function FeaturePickerModal({
  allFeatures,
  linkedIds,
  stages,
  specId,
  onPick,
  onClose,
}: FeaturePickerModalProps) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const createMut = useCreateFeature();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = allFeatures
    .filter((f) => !linkedIds.has(f.id))
    .filter((f) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        f.title.toLowerCase().includes(q) ||
        f.status.toLowerCase().includes(q)
      );
    });

  async function submitNewFeature() {
    const title = newTitle.trim();
    if (!title) {
      setCreating(false);
      setNewTitle("");
      return;
    }
    try {
      const created = await createMut.mutateAsync({
        title,
        status: stages[0]?.id ?? "todo",
        linkedSpecIds: [specId],
      });
      // The create endpoint returns the new Feature. Close after linking —
      // no need to also call updateFeature since linkedSpecIds went in at
      // creation time.
      onPick(created);
    } catch {
      // apiFetch surfaces the error via toast; keep the form open for retry.
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100">
          <h3 className="text-sm font-semibold text-stone-800">Link a feature</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!creating && (
          <div className="px-5 py-3 border-b border-stone-100 flex items-center gap-2">
            <Search size={14} className="text-stone-400" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search features by title or status…"
              className="flex-1 text-sm text-stone-700 bg-transparent focus:outline-none"
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-1">
          {creating ? (
            <div className="px-5 py-4 space-y-2">
              <label className="text-xs text-stone-500 block">New feature title</label>
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitNewFeature();
                    if (e.key === "Escape") {
                      setCreating(false);
                      setNewTitle("");
                    }
                  }}
                  placeholder="What's the feature?"
                  className="flex-1 rounded-md border border-accent bg-white px-3 py-2 text-sm text-stone-700 focus:outline-none"
                />
                <button
                  onClick={submitNewFeature}
                  disabled={createMut.isPending}
                  className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs text-white hover:bg-accent/90 disabled:opacity-60 cursor-pointer"
                >
                  <Plus size={12} /> {createMut.isPending ? "Creating…" : "Create + link"}
                </button>
                <button
                  onClick={() => {
                    setCreating(false);
                    setNewTitle("");
                  }}
                  className="rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-600 hover:bg-stone-50 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
              <p className="text-[11px] text-stone-400">
                Feature lands in the first board stage ({stages[0]?.label ?? "todo"}). Fine-tune
                status, owners and plan on the Features tab afterwards.
              </p>
            </div>
          ) : (
            <>
              <button
                onClick={() => setCreating(true)}
                className="w-full flex items-center gap-2 px-5 py-2 text-left cursor-pointer hover:bg-stone-50 border-b border-stone-100"
              >
                <Plus size={14} className="text-accent" />
                <span className="text-sm text-accent">Create new feature…</span>
              </button>

              {filtered.length === 0 ? (
                <div className="px-5 py-8 text-center text-xs text-stone-400">
                  {allFeatures.length === 0
                    ? "No features yet. Create one to link it here."
                    : "No matches."}
                </div>
              ) : (
                filtered.map((f) => {
                  const stage = stages.find((s) => s.id === f.status);
                  return (
                    <button
                      key={f.id}
                      onClick={() => onPick(f)}
                      className="w-full flex items-center gap-3 px-5 py-2 text-left cursor-pointer hover:bg-stone-50"
                    >
                      <Rocket size={14} className="shrink-0 text-stone-400" />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-sm text-stone-700">
                          {f.title || <span className="text-stone-400">Untitled</span>}
                        </span>
                      </span>
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-stone-50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-stone-500 border border-stone-200 shrink-0"
                        title={`Status: ${stage?.label ?? f.status}`}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
                        />
                        {stage?.label ?? f.status ?? "—"}
                      </span>
                    </button>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
