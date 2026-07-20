import { useMemo, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { FileText, Plus, Search, X } from "lucide-react";
import { useSpecs, useCreateSpec, useUpdateSpec } from "@/hooks/useSpecs";
import type { Spec } from "@/lib/types";

interface Props {
  featureNumber: number;
}

// Renders the "Specs" section inside FeatureDetailModal under the unified
// model — a spec belongs to at most one feature (Spec.featureNumber). This
// section lists everything where featureNumber === this feature, offers to
// attach existing (Unfiled) specs, and creates new specs pre-attached.
export function FeatureLinkedSpecsSection({ featureNumber }: Props) {
  // One query pulls every active spec org-wide; filtered locally so both
  // the chip list AND the picker use the same cached data.
  const specsQ = useSpecs({ featureNumber: "all" });
  const allSpecs = useMemo<Spec[]>(() => specsQ.data ?? [], [specsQ.data]);

  const ownSpecs = useMemo(
    () => allSpecs.filter((s) => s.featureNumber === featureNumber && !s.archived),
    [allSpecs, featureNumber],
  );
  const availableSpecs = useMemo(
    () => allSpecs.filter((s) => s.featureNumber == null && !s.archived),
    [allSpecs],
  );

  const [pickerOpen, setPickerOpen] = useState(false);

  const updateMut = useUpdateSpec();

  function detach(spec: Spec) {
    updateMut.mutate({ id: spec.id, featureNumber: null });
  }

  function attach(spec: Spec) {
    updateMut.mutate({ id: spec.id, featureNumber });
  }

  return (
    <div>
      <span className="text-xs text-stone-500 block mb-1.5">Specs</span>
      {ownSpecs.length === 0 ? (
        <p className="text-xs text-stone-400 italic mb-2">
          No specs on this feature yet.
        </p>
      ) : (
        <ul className="space-y-1.5 mb-2">
          {ownSpecs.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1.5"
            >
              <FileText size={12} className="shrink-0 text-stone-400" />
              <a
                href={`/?tab=specs&spec=${s.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 truncate text-xs text-stone-700 hover:text-accent"
                title={s.title}
              >
                {s.title || <span className="text-stone-400">Untitled</span>}
              </a>
              <button
                type="button"
                onClick={() => detach(s)}
                className="text-stone-300 hover:text-red-500 cursor-pointer"
                title="Detach — move to Unfiled"
                aria-label={`Detach spec ${s.title}`}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-accent cursor-pointer"
      >
        <Plus size={12} /> Add spec
      </button>

      {pickerOpen && (
        <SpecPickerModal
          available={availableSpecs}
          featureNumber={featureNumber}
          onAttach={(s) => {
            attach(s);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

interface SpecPickerModalProps {
  available: Spec[];
  featureNumber: number;
  onAttach: (spec: Spec) => void;
  onClose: () => void;
}

function SpecPickerModal({ available, featureNumber, onAttach, onClose }: SpecPickerModalProps) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const createMut = useCreateSpec();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return available;
    const q = search.toLowerCase();
    return available.filter((s) => s.title.toLowerCase().includes(q));
  }, [available, search]);

  async function submitNewSpec() {
    const t = newTitle.trim();
    if (!t) {
      setCreating(false);
      setNewTitle("");
      return;
    }
    try {
      const spec = await createMut.mutateAsync({
        title: t,
        featureNumber,
      });
      onAttach(spec);
    } catch {
      // apiFetch surfaces the error via toast; keep form open for retry.
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
          <h3 className="text-sm font-semibold text-stone-800">Add a spec</h3>
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
              placeholder="Search unfiled specs by title…"
              className="flex-1 text-sm text-stone-700 bg-transparent focus:outline-none"
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-1">
          {creating ? (
            <div className="px-5 py-4 space-y-2">
              <label className="text-xs text-stone-500 block">New spec title</label>
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitNewSpec();
                    if (e.key === "Escape") {
                      setCreating(false);
                      setNewTitle("");
                    }
                  }}
                  placeholder="What's the spec about?"
                  className="flex-1 rounded-md border border-accent bg-white px-3 py-2 text-sm text-stone-700 focus:outline-none"
                />
                <button
                  onClick={submitNewSpec}
                  disabled={createMut.isPending}
                  className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs text-white hover:bg-accent/90 disabled:opacity-60 cursor-pointer"
                >
                  <Plus size={12} /> {createMut.isPending ? "Creating…" : "Create + attach"}
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
                Description + links can be edited on the Specs tab.
              </p>
            </div>
          ) : (
            <>
              <button
                onClick={() => setCreating(true)}
                className="w-full flex items-center gap-2 px-5 py-2 text-left cursor-pointer hover:bg-stone-50 border-b border-stone-100"
              >
                <Plus size={14} className="text-accent" />
                <span className="text-sm text-accent">Create new spec…</span>
              </button>

              {filtered.length === 0 ? (
                <div className="px-5 py-8 text-center text-xs text-stone-400">
                  {available.length === 0
                    ? "No unfiled specs. Create one to attach it here."
                    : "No matches."}
                </div>
              ) : (
                filtered.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onAttach(s)}
                    className="w-full flex items-center gap-3 px-5 py-2 text-left cursor-pointer hover:bg-stone-50"
                  >
                    <FileText size={14} className="shrink-0 text-stone-400" />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-sm text-stone-700">
                        {s.title || <span className="text-stone-400">Untitled</span>}
                      </span>
                      {s.legacyFolderName && (
                        <span className="block truncate text-[11px] text-stone-400">
                          was in: {s.legacyFolderName}
                        </span>
                      )}
                    </span>
                  </button>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
