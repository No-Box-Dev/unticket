import { useState } from "react";
import { Check, ArrowRight, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { EffortTag } from "./EffortTag";
import { AssignDropdown } from "./AssignDropdown";
import { FeatureDetailModal } from "./FeatureDetailModal";
import type { Feature, Effort } from "@/lib/types";

interface FeatureCardProps {
  feature: Feature;
  allPeople: string[];
  onUpdate: (updated: Feature) => void;
  onDelete: (id: string) => void;
  mode: "sprint" | "backlog";
  currentSprint?: number;
}

export function FeatureCard({
  feature,
  allPeople,
  onUpdate,
  onDelete,
  mode,
  currentSprint,
}: FeatureCardProps) {
  const [showModal, setShowModal] = useState(false);

  const statusDot =
    feature.status === "done"
      ? "bg-green-500"
      : feature.status === "active"
        ? "bg-blue-500"
        : "bg-stone-300";

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
          feature.status === "done" ? "bg-stone-50 opacity-60" : "hover:bg-stone-50",
        )}
      >
        <span className={cn("w-2 h-2 rounded-full flex-shrink-0", statusDot)} />

        <button
          onClick={() => setShowModal(true)}
          className="flex-1 text-sm text-stone-700 text-left truncate cursor-pointer hover:text-brand"
        >
          {feature.title}
        </button>

        <EffortTag
          effort={feature.effort}
          onChange={(effort: Effort) => onUpdate({ ...feature, effort })}
        />

        <AssignDropdown
          owners={feature.owners}
          allPeople={allPeople}
          onChange={(owners) => onUpdate({ ...feature, owners })}
        />

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {mode === "sprint" && feature.status !== "done" && (
            <button
              onClick={() => onUpdate({ ...feature, status: "done" })}
              title="Mark done"
              className="p-1 text-stone-400 hover:text-green-600 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          )}
          {mode === "backlog" && currentSprint && (
            <button
              onClick={() => onUpdate({ ...feature, sprint: currentSprint, status: "active" })}
              title="Move to current sprint"
              className="p-1 text-stone-400 hover:text-brand cursor-pointer"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => onDelete(feature.id)}
            title="Delete"
            className="p-1 text-stone-400 hover:text-red-500 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {showModal && (
        <FeatureDetailModal
          feature={feature}
          allPeople={allPeople}
          onClose={() => setShowModal(false)}
          onUpdate={(updated) => {
            onUpdate(updated);
          }}
        />
      )}
    </>
  );
}
