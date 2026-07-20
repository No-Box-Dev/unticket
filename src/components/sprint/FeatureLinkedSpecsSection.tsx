import { useMemo, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { FileText, Plus, Search, X } from "lucide-react";
import { useSpecFolders, useSpecs } from "@/hooks/useSpecs";
import { SpecEditorForm } from "@/components/specs/SpecEditorForm";
import type { Spec, SpecFolder } from "@/lib/types";

interface Props {
  value: number[];
  onChange: (ids: number[]) => void;
}

// Renders the "Linked specs" section inside FeatureDetailModal.
// Existing links show as chips (title + folder name). "+ Link spec" opens a
// picker: search box → filtered list of specs (excluding already-linked ones)
// with "+ Create new spec…" pinned at the top → chosen spec is appended.
// Clicking a chip opens the spec detail modal on the Specs tab via a
// deep-link — same URL pattern used from SpecsTab so behaviour is uniform.
export function FeatureLinkedSpecsSection({ value, onChange }: Props) {
  const specsQ = useSpecs({ folderId: "all", includeArchived: true });
  const foldersQ = useSpecFolders({ includeArchived: true });

  const specsById = useMemo(() => {
    const m = new Map<number, Spec>();
    (specsQ.data ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [specsQ.data]);

  const foldersById = useMemo(() => {
    const m = new Map<number, SpecFolder>();
    (foldersQ.data ?? []).forEach((f) => m.set(f.id, f));
    return m;
  }, [foldersQ.data]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState(false);

  const linkedSpecs = value
    .map((id) => specsById.get(id))
    .filter((s): s is Spec => Boolean(s));

  function removeId(id: number) {
    onChange(value.filter((v) => v !== id));
  }

  function addId(id: number) {
    if (value.includes(id)) return;
    onChange([...value, id]);
  }

  return (
    <div>
      <span className="text-xs text-stone-500 block mb-1.5">Linked specs</span>
      {linkedSpecs.length === 0 ? (
        <p className="text-xs text-stone-400 italic mb-2">
          No specs linked yet.
        </p>
      ) : (
        <ul className="space-y-1.5 mb-2">
          {linkedSpecs.map((s) => {
            const folder = s.folderId != null ? foldersById.get(s.folderId) ?? null : null;
            return (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1.5"
              >
                <FileText size={12} className="shrink-0 text-stone-400" />
                <a
                  href={`/?tab=specs&folder=${folder ? folder.id : "unfiled"}&spec=${s.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 truncate text-xs text-stone-700 hover:text-accent"
                  title={s.title}
                >
                  {s.title || <span className="text-stone-400">Untitled</span>}
                </a>
                {folder && (
                  <span className="text-[10px] text-stone-400 truncate max-w-[120px]">
                    {folder.name}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeId(s.id)}
                  className="text-stone-300 hover:text-red-500 cursor-pointer"
                  title="Unlink"
                  aria-label={`Unlink spec ${s.title}`}
                >
                  <X size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Orphaned ids: linked specs that vanished (deleted from another
          session, or belong to another org that a corrupt payload references).
          Render a stub row so the user can see + remove them. */}
      {value.length > linkedSpecs.length && (
        <p className="text-[11px] text-stone-400 italic mb-2">
          {value.length - linkedSpecs.length} link
          {value.length - linkedSpecs.length === 1 ? "" : "s"} to spec
          {value.length - linkedSpecs.length === 1 ? "" : "s"} that no longer exist.
          <button
            onClick={() => onChange(linkedSpecs.map((s) => s.id))}
            className="ml-2 underline text-stone-500 hover:text-red-500 cursor-pointer"
          >
            Clean up
          </button>
        </p>
      )}

      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-accent cursor-pointer"
      >
        <Plus size={12} /> Link spec
      </button>

      {pickerOpen && (
        <SpecPickerModal
          allSpecs={specsQ.data ?? []}
          foldersById={foldersById}
          excludeIds={value}
          onPick={(id) => {
            addId(id);
            setPickerOpen(false);
          }}
          onCreateNew={() => {
            setPickerOpen(false);
            setCreatorOpen(true);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {creatorOpen && (
        <SpecEditorForm
          folders={(foldersQ.data ?? []).filter((f) => !f.archived)}
          initialFolderId={null}
          onClose={() => setCreatorOpen(false)}
          onCreated={(spec) => {
            addId(spec.id);
            setCreatorOpen(false);
          }}
        />
      )}
    </div>
  );
}

interface SpecPickerModalProps {
  allSpecs: Spec[];
  foldersById: Map<number, SpecFolder>;
  excludeIds: number[];
  onPick: (id: number) => void;
  onCreateNew: () => void;
  onClose: () => void;
}

function SpecPickerModal({
  allSpecs,
  foldersById,
  excludeIds,
  onPick,
  onCreateNew,
  onClose,
}: SpecPickerModalProps) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const excluded = new Set(excludeIds);
  const filtered = allSpecs
    .filter((s) => !excluded.has(s.id))
    .filter((s) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        s.title.toLowerCase().includes(q) ||
        (s.folderId != null && (foldersById.get(s.folderId)?.name.toLowerCase().includes(q) ?? false))
      );
    })
    // Active specs first, archived at the bottom.
    .sort((a, b) => Number(a.archived) - Number(b.archived));

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
          <h3 className="text-sm font-semibold text-stone-800">Link a spec</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-3 border-b border-stone-100 flex items-center gap-2">
          <Search size={14} className="text-stone-400" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search specs by title or project…"
            className="flex-1 text-sm text-stone-700 bg-transparent focus:outline-none"
          />
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          <button
            onClick={onCreateNew}
            className="w-full flex items-center gap-2 px-5 py-2 text-left cursor-pointer hover:bg-stone-50 border-b border-stone-100"
          >
            <Plus size={14} className="text-accent" />
            <span className="text-sm text-accent">Create new spec…</span>
          </button>

          {filtered.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-stone-400">
              {allSpecs.length === 0
                ? "No specs yet. Create one to get started."
                : "No matches."}
            </div>
          ) : (
            filtered.map((s) => {
              const folder = s.folderId != null ? foldersById.get(s.folderId) ?? null : null;
              return (
                <button
                  key={s.id}
                  onClick={() => onPick(s.id)}
                  className="w-full flex items-center gap-3 px-5 py-2 text-left cursor-pointer hover:bg-stone-50"
                >
                  <FileText size={14} className="shrink-0 text-stone-400" />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-sm text-stone-700">
                      {s.title || <span className="text-stone-400">Untitled</span>}
                      {s.archived && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-stone-400 border border-stone-200 rounded-full px-1.5 py-0.5">
                          Archived
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-stone-400">
                      {folder ? folder.name : "Unfiled"}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
