import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Pencil, Undo2, X } from "lucide-react";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { ConfirmDialog, useConfirm } from "@/components/ui/ConfirmDialog";
import { useIsAdmin } from "@/hooks/useGitHub";
import { SpecLinksSection } from "@/components/specs/SpecLinksSection";
import { SpecLinkedFeaturesSection } from "@/components/specs/SpecLinkedFeaturesSection";
import { useSetSpecArchived, useUpdateSpec } from "@/hooks/useSpecs";
import type { Spec, SpecFolder, SpecLink } from "@/lib/types";

interface Props {
  spec: Spec;
  folders: SpecFolder[];
  onClose: () => void;
}

// Local draft mirrors FeatureDetailModal's shape: debounced text saves via
// `saveDebounced`, immediate saves for structural changes (folder, links).
// `hasUnsavedChanges` ref lets us flush pending edits on close.
export function SpecDetailModal({ spec, folders, onClose }: Props) {
  const [draft, setDraft] = useState<Spec>(spec);

  const updateMut = useUpdateSpec();
  const setArchivedMut = useSetSpecArchived();
  const isAdmin = useIsAdmin();
  const { confirm, dialogProps } = useConfirm();

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hasUnsavedChanges = useRef(false);

  type SpecPatch = { id: number; title?: string; description?: string; folderId?: number | null; links?: SpecLink[] };

  const save = useCallback(
    (patch: SpecPatch) => {
      hasUnsavedChanges.current = false;
      updateMut.mutate(patch);
    },
    [updateMut],
  );

  const saveDebounced = useCallback(
    (patch: SpecPatch) => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => save(patch), 500);
    },
    [save],
  );

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const setTitle = (title: string) => {
    setDraft((d) => {
      const next = { ...d, title };
      hasUnsavedChanges.current = true;
      saveDebounced({ id: next.id, title });
      return next;
    });
  };

  const setDescription = (description: string) => {
    setDraft((d) => {
      const next = { ...d, description };
      hasUnsavedChanges.current = true;
      saveDebounced({ id: next.id, description });
      return next;
    });
  };

  const setLinks = (links: SpecLink[]) => {
    setDraft((d) => {
      const next = { ...d, links };
      hasUnsavedChanges.current = true;
      saveDebounced({ id: next.id, links });
      return next;
    });
  };

  const setFolderId = (folderIdRaw: string) => {
    const folderId = folderIdRaw === "" ? null : Number.parseInt(folderIdRaw, 10);
    if (folderIdRaw !== "" && !Number.isFinite(folderId)) return;
    setDraft((d) => {
      const next = { ...d, folderId };
      hasUnsavedChanges.current = false;
      clearTimeout(debounceRef.current);
      save({ id: next.id, folderId });
      return next;
    });
  };

  function handleClose() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
      if (hasUnsavedChanges.current) {
        // Flush all currently-dirty fields in one final PATCH — cheaper than
        // remembering which ones the user touched, and the server merges
        // partial patches identically.
        updateMut.mutate({
          id: draft.id,
          title: draft.title,
          description: draft.description,
          folderId: draft.folderId,
          links: draft.links,
        });
        hasUnsavedChanges.current = false;
      }
    }
    onClose();
  }

  const folderOptions = useMemo(() => {
    // Show only active folders in the picker. If the spec is currently in
    // an archived folder, include that folder at the top so the user can
    // still see where it lives (and move it out).
    const opts = [{ value: "", label: "Unfiled" }, ...folders
      .filter((f) => !f.archived)
      .map((f) => ({ value: String(f.id), label: f.name }))];
    if (draft.folderId != null) {
      const current = folders.find((f) => f.id === draft.folderId);
      if (current && current.archived) {
        opts.unshift({ value: String(current.id), label: `${current.name} (archived)` });
      }
    }
    return opts;
  }, [folders, draft.folderId]);

  async function handleArchive() {
    const ok = await confirm({
      title: draft.archived ? "Restore this spec?" : "Archive this spec?",
      message: draft.archived
        ? "The spec will move back to its project (or Unfiled)."
        : "You can restore it later from the Archive section.",
      confirmLabel: draft.archived ? "Restore" : "Archive",
      variant: draft.archived ? "default" : "danger",
    });
    if (!ok) return;
    setArchivedMut.mutate(
      { id: draft.id, archived: !draft.archived },
      {
        onSuccess: () => {
          handleClose();
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
          <button onClick={handleClose} className="text-stone-400 hover:text-stone-600 cursor-pointer ml-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="min-w-[200px]">
              <span className="text-xs text-stone-500 block mb-1">Project</span>
              <SearchableSelect
                value={draft.folderId != null ? String(draft.folderId) : ""}
                onChange={setFolderId}
                options={folderOptions}
                placeholder="Unfiled"
                className="w-full"
              />
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

          <SpecLinksSection value={draft.links} onChange={setLinks} label="Links" />

          <SpecLinkedFeaturesSection specId={draft.id} />

          {isAdmin && (
            <div className="pt-3 border-t border-stone-100 flex items-center justify-between">
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
          )}
        </div>
      </div>
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
