import { useMemo, useState } from "react";
import { FileText, Plus, Star, X } from "lucide-react";
import { SpecEditorForm } from "@/components/specs/SpecEditorForm";
import { useSpecs, useUpdateSpec } from "@/hooks/useSpecs";
import type { Feature, Spec } from "@/lib/types";

interface Props {
  featureNumber: number;
  features: Feature[];
}

// A feature can only add a complete Spec. The full editor opens already filed
// against this feature, and closing or creating it reveals the feature modal
// underneath again.
export function FeatureLinkedSpecsSection({
  featureNumber,
  features,
}: Props) {
  const specsQ = useSpecs({ featureNumber: "all" });
  const allSpecs = useMemo<Spec[]>(() => specsQ.data ?? [], [specsQ.data]);
  const ownSpecs = useMemo(
    () => allSpecs.filter((s) => s.featureNumber === featureNumber && !s.archived),
    [allSpecs, featureNumber],
  );
  const [createOpen, setCreateOpen] = useState(false);
  const updateMut = useUpdateSpec();

  function detach(spec: Spec) {
    updateMut.mutate({ id: spec.id, featureNumber: null });
  }

  function setPrimary(spec: Spec) {
    if (!spec.isPrimary) updateMut.mutate({ id: spec.id, isPrimary: true });
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
          {ownSpecs.map((spec) => (
            <li
              key={spec.id}
              className="flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1.5"
            >
              <FileText size={12} className="shrink-0 text-stone-400" />
              <a
                href={`/?tab=specs&spec=${spec.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 truncate text-xs text-stone-700 hover:text-accent"
                title={spec.title}
              >
                {spec.title || <span className="text-stone-400">Untitled</span>}
              </a>
              {ownSpecs.length > 1 && (
                <button
                  type="button"
                  onClick={() => setPrimary(spec)}
                  aria-label={`Set ${spec.title || "Untitled"} as primary spec`}
                  aria-pressed={spec.isPrimary}
                  className={spec.isPrimary
                    ? "text-amber-500 cursor-default"
                    : "text-stone-300 hover:text-amber-500 cursor-pointer"}
                  title={spec.isPrimary
                    ? "Primary spec shown on the feature card"
                    : "Show this spec on the feature card"}
                >
                  <Star size={13} fill={spec.isPrimary ? "currentColor" : "none"} />
                </button>
              )}
              <button
                type="button"
                onClick={() => detach(spec)}
                className="text-stone-300 hover:text-red-500 cursor-pointer"
                title="Detach — move to Unfiled"
                aria-label={`Detach spec ${spec.title}`}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setCreateOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 cursor-pointer"
      >
        <Plus size={12} /> Add spec
      </button>

      {createOpen && (
        <SpecEditorForm
          features={features}
          initialFeatureNumber={featureNumber}
          lockedFeatureNumber={featureNumber}
          onClose={() => setCreateOpen(false)}
          onCreated={() => setCreateOpen(false)}
        />
      )}
    </div>
  );
}
