import { useMemo, useRef, useState } from "react";
import { Archive, Pencil, Undo2, X } from "lucide-react";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { ConfirmDialog, useConfirm } from "@/components/ui/ConfirmDialog";
import { useIsAdmin } from "@/hooks/useGitHub";
import { useBoardStages } from "@/lib/board-stages";
import { SpecSourcesSection } from "@/components/specs/SpecSourcesSection";
import { useSetSpecArchived, useUpdateSpec } from "@/hooks/useSpecs";
import type { Feature, Spec, SpecLink } from "@/lib/types";

interface Props {
  spec: Spec;
  features: Feature[];
  onClose: () => void;
}

// Local draft mirrors FeatureDetailModal's explicit-save behavior. All form
// fields remain local until Save; closing a dirty modal requires confirmation.
export function SpecDetailModal({ spec, features, onClose }: Props) {
  const [draft, setDraft] = useState<Spec>(spec);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const stages = useBoardStages();

  const updateMut = useUpdateSpec();
  const setArchivedMut = useSetSpecArchived();
  const isAdmin = useIsAdmin();
  const { confirm, dialogProps } = useConfirm();

  type SpecPatch = { id: number; title?: string; description?: string; featureNumber?: number | null; links?: SpecLink[] };

  const markDirty = () => {
    dirtyRef.current = true;
    setDirty(true);
  };

  const setTitle = (title: string) => {
    markDirty();
    setDraft((d) => ({ ...d, title }));
  };

  const setDescription = (description: string) => {
    markDirty();
    setDraft((d) => ({ ...d, description }));
  };

  const setLinks = (links: SpecLink[]) => {
    markDirty();
    setDraft((d) => ({ ...d, links }));
  };

  const setFeatureNumber = (raw: string) => {
    const featureNumber = raw === "" ? null : Number.parseInt(raw, 10);
    if (raw !== "" && !Number.isFinite(featureNumber)) return;
    markDirty();
    setDraft((d) => ({ ...d, featureNumber }));
  };

  function handleSave() {
    const patch: SpecPatch = {
      id: draft.id,
      title: draft.title,
      description: draft.description,
      featureNumber: draft.featureNumber,
      links: draft.links,
    };
    updateMut.mutate(patch, {
      onSuccess: () => {
        dirtyRef.current = false;
        setDirty(false);
      },
    });
  }

  async function handleClose() {
    if (dirtyRef.current) {
      const discard = await confirm({
        title: "Discard unsaved changes?",
        message: "Your changes to this spec have not been saved.",
        confirmLabel: "Discard",
        variant: "danger",
      });
      if (!discard) return;
    }
    onClose();
  }

  const featureOptions = useMemo(() => {
    // Every feature (including "done"-column ones) so a spec can be filed
    // even against a shipped feature. Sorted by title.
    return [
      { value: "", label: "Unfiled" },
      ...features
        .slice()
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((f) => ({ value: String(f.id), label: f.title || `#${f.id}` })),
    ];
  }, [features]);

  const currentFeature = draft.featureNumber != null
    ? features.find((f) => f.id === draft.featureNumber) ?? null
    : null;
  const currentFeatureStage = currentFeature
    ? stages.find((s) => s.id === currentFeature.status) ?? null
    : null;

  async function handleArchive() {
    const ok = await confirm({
      title: draft.archived ? "Restore this spec?" : "Archive this spec?",
      message: draft.archived
        ? `The spec will move back into its feature (or Unfiled).${dirty ? " Unsaved changes will be discarded." : ""}`
        : `You can restore it later from the Archive section.${dirty ? " Unsaved changes will be discarded." : ""}`,
      confirmLabel: draft.archived ? "Restore" : "Archive",
      variant: draft.archived ? "default" : "danger",
    });
    if (!ok) return;
    setArchivedMut.mutate(
      { id: draft.id, archived: !draft.archived },
      {
        onSuccess: () => {
          onClose();
        },
      },
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={handleClose}
    >
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
              onChange={(e) => setTitle(e.target.value)}
              className="text-lg font-semibold text-stone-800 bg-transparent w-full rounded px-2 py-1 -mx-2 border border-transparent hover:border-stone-200 focus:border-accent/40 focus:ring-2 focus:ring-accent/20 outline-none transition-all"
              title="Click to edit title"
            />
            <Pencil size={14} className="shrink-0 text-stone-300 group-hover/title:text-stone-400 transition-colors" />
          </div>
          <button aria-label="Close spec" onClick={handleClose} className="text-stone-400 hover:text-stone-600 cursor-pointer ml-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="min-w-[240px]">
              <span className="text-xs text-stone-500 block mb-1">Feature</span>
              <SearchableSelect
                value={draft.featureNumber != null ? String(draft.featureNumber) : ""}
                onChange={setFeatureNumber}
                options={featureOptions}
                placeholder="Unfiled"
                className="w-full"
              />
              {currentFeature && (
                <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-stone-500">
                  {currentFeatureStage && (
                    <>
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: currentFeatureStage.color }}
                      />
                      {currentFeatureStage.label}
                    </>
                  )}
                  {currentFeature.owners.length > 0 && (
                    <span className="text-stone-400">
                      · {currentFeature.owners.join(", ")}
                    </span>
                  )}
                </div>
              )}
            </div>
            {draft.archived && (
              <div className="text-xs text-stone-400 italic">
                Archived {draft.archivedAt ? new Date(draft.archivedAt).toLocaleDateString() : ""}
              </div>
            )}
          </div>

          <div>
            <span className="text-xs text-stone-500 block mb-1.5">Description</span>
            <textarea
              value={draft.description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes, context, links to raw research… (Markdown)"
              className="w-full rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700 font-mono whitespace-pre-wrap focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent resize-y min-h-[160px] max-h-[50vh]"
              rows={8}
            />
          </div>

          <SpecSourcesSection
            specId={draft.id}
            links={draft.links}
            onLinksChange={setLinks}
          />

          <div className="pt-3 border-t border-stone-100 flex items-center justify-between gap-3">
            {isAdmin ? (
              <div className="flex items-center justify-between gap-3 flex-1">
              <span className="text-[11px] text-stone-400">
                Admin actions
              </span>
              <button
                onClick={handleArchive}
                className={
                  draft.archived
                    ? "inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-stone-600 hover:border-accent hover:text-accent cursor-pointer"
                    : "inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50/60 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 cursor-pointer"
                }
              >
                {draft.archived ? (
                  <>
                    <Undo2 size={12} /> Restore
                  </>
                ) : (
                  <>
                    <Archive size={12} /> Archive
                  </>
                )}
              </button>
              </div>
            ) : <span />}
            <button
              onClick={handleSave}
              disabled={!dirty || updateMut.isPending}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            >
              {updateMut.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
