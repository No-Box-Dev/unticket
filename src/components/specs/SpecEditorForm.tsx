import { useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { SpecLinksSection } from "@/components/specs/SpecLinksSection";
import { useCreateSpec } from "@/hooks/useSpecs";
import { useCreateFeature } from "@/hooks/useConfigRepo";
import { useBoardStages } from "@/lib/board-stages";
import type { Feature, Spec, SpecLink } from "@/lib/types";

interface Props {
  features: Feature[];
  initialFeatureNumber: number | null;
  onClose: () => void;
  onCreated: (spec: Spec) => void;
}

// Modal for creating a new spec under the unified Features model. The
// feature picker has a synthetic "+ Create new feature…" row at the top —
// choosing it swaps in a compact create-inline input so a spec can be
// filed against a brand-new feature without leaving this modal.
export function SpecEditorForm({ features, initialFeatureNumber, onClose, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [featureNumber, setFeatureNumber] = useState<number | null>(initialFeatureNumber);
  const [links, setLinks] = useState<SpecLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creatingFeature, setCreatingFeature] = useState(false);
  const [newFeatureTitle, setNewFeatureTitle] = useState("");
  const submitRef = useRef<HTMLButtonElement>(null);

  const createSpecMut = useCreateSpec();
  const createFeatureMut = useCreateFeature();
  const stages = useBoardStages();

  const featureOptions = useMemo(
    () => [
      { value: "__new__", label: "+ Create new feature…" },
      { value: "", label: "Unfiled" },
      ...features
        .slice()
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((f) => ({ value: String(f.id), label: f.title || `#${f.id}` })),
    ],
    [features],
  );

  function handleFeaturePick(raw: string) {
    if (raw === "__new__") {
      setCreatingFeature(true);
      return;
    }
    setFeatureNumber(raw === "" ? null : Number.parseInt(raw, 10));
  }

  async function confirmNewFeature() {
    const featTitle = newFeatureTitle.trim();
    if (!featTitle) {
      setCreatingFeature(false);
      setNewFeatureTitle("");
      return;
    }
    try {
      const created = await createFeatureMut.mutateAsync({
        title: featTitle,
        status: stages[0]?.id ?? "todo",
      });
      setFeatureNumber(created.id);
      setCreatingFeature(false);
      setNewFeatureTitle("");
    } catch {
      // apiFetch already surfaced the error via toast — leave the input open
      // for retry / cancel.
    }
  }

  async function submit() {
    const t = title.trim();
    if (!t) {
      setError("Title is required");
      return;
    }
    setError(null);
    try {
      const spec = await createSpecMut.mutateAsync({
        title: t,
        description: description.trim() || undefined,
        featureNumber,
        links: links.length ? links : undefined,
      });
      onCreated(spec);
    } catch {
      // Toast surface + no-op — leave modal open for user retry.
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <h3 className="text-sm font-semibold text-stone-800">New spec</h3>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-xs text-stone-500 block mb-1">Title</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
              placeholder="What's this spec about?"
              className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 focus:outline-none focus:border-accent"
            />
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>

          <div>
            <label className="text-xs text-stone-500 block mb-1">Feature</label>
            {creatingFeature ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={newFeatureTitle}
                  onChange={(e) => setNewFeatureTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmNewFeature();
                    if (e.key === "Escape") {
                      setCreatingFeature(false);
                      setNewFeatureTitle("");
                    }
                  }}
                  placeholder="Feature title"
                  className="flex-1 rounded-md border border-accent bg-white px-3 py-2 text-sm text-stone-700 focus:outline-none"
                />
                <button
                  onClick={confirmNewFeature}
                  disabled={createFeatureMut.isPending}
                  className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs text-white hover:bg-accent/90 disabled:opacity-60 cursor-pointer"
                >
                  <Plus size={12} /> {createFeatureMut.isPending ? "Creating…" : "Create"}
                </button>
                <button
                  onClick={() => {
                    setCreatingFeature(false);
                    setNewFeatureTitle("");
                  }}
                  className="rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-600 hover:bg-stone-50 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <SearchableSelect
                value={featureNumber != null ? String(featureNumber) : ""}
                onChange={handleFeaturePick}
                options={featureOptions}
                placeholder="Unfiled"
                className="w-full"
              />
            )}
            {!creatingFeature && (
              <p className="text-[11px] text-stone-400 mt-1">
                New features land in the first board stage ({stages[0]?.label ?? "todo"}). Fine-tune
                status, owners and plan on the Features tab.
              </p>
            )}
          </div>

          <div>
            <label className="text-xs text-stone-500 block mb-1">Description (Markdown)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional. Notes, context, links to raw research…"
              className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 font-mono focus:outline-none focus:border-accent resize-y min-h-[120px]"
              rows={6}
            />
          </div>

          <SpecLinksSection value={links} onChange={setLinks} label="Links" />
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-stone-100">
          <button
            onClick={onClose}
            className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            ref={submitRef}
            onClick={submit}
            disabled={createSpecMut.isPending}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-60 cursor-pointer"
          >
            {createSpecMut.isPending ? "Creating…" : "Create spec"}
          </button>
        </div>
      </div>
    </div>
  );
}
