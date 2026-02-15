import { cn } from "@/lib/cn";
import { EffortTag } from "./EffortTag";
import { PriorityTag } from "./PriorityTag";
import { AssignDropdown } from "./AssignDropdown";
import type { Feature, Effort, Priority } from "@/lib/types";

interface FeatureCardProps {
  feature: Feature;
  allPeople: string[];
  onUpdate: (updated: Feature) => void;
  onDelete: (id: string) => void;
  onOpenDetail: (feature: Feature) => void;
  mode: "sprint" | "backlog";
  currentSprint?: number;
}

export function FeatureCard({
  feature,
  allPeople,
  onUpdate,
  onDelete,
  onOpenDetail,
  mode,
  currentSprint,
}: FeatureCardProps) {
  const dotColor =
    feature.status === "done"
      ? "bg-green-500"
      : feature.status === "active"
        ? "bg-brand"
        : "bg-stone-300";

  return (
    <div
      className={cn(
        "group px-3 py-3 border-b border-stone-100 last:border-b-0 transition-colors",
        feature.status === "done" && "opacity-50",
      )}
    >
      {/* Row 1: dot + title + effort + floating actions */}
      <div className="flex items-center gap-3">
        <span className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0", dotColor)} />

        <button
          onClick={() => onOpenDetail(feature)}
          className="text-sm font-medium text-stone-800 text-left truncate cursor-pointer hover:text-brand"
        >
          {feature.title}
        </button>

        <PriorityTag
          priority={feature.priority ?? "none"}
          onChange={(priority: Priority) => onUpdate({ ...feature, priority })}
        />
        <EffortTag
          effort={feature.effort}
          onChange={(effort: Effort) => onUpdate({ ...feature, effort })}
        />

        {/* Spacer to push actions right */}
        <div className="flex-1" />

        {/* Floating text actions */}
        <div className="flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-opacity">
          {mode === "sprint" && feature.status !== "done" && (
            <button
              onClick={() => onUpdate({ ...feature, status: "future", sprint: null })}
              className="text-xs text-stone-400 hover:text-stone-600 cursor-pointer"
            >
              Future
            </button>
          )}
          {mode === "backlog" && currentSprint && (
            <button
              onClick={() => onUpdate({ ...feature, sprint: currentSprint, status: "active" })}
              className="text-xs text-stone-400 hover:text-brand cursor-pointer"
            >
              Move to Sprint
            </button>
          )}
          <button
            onClick={() => onDelete(feature.id)}
            className="text-xs text-stone-400 hover:text-red-500 cursor-pointer"
          >
            Delete
          </button>
          {mode === "sprint" && feature.status !== "done" && (
            <button
              onClick={() => onUpdate({ ...feature, status: "done" })}
              className="text-xs text-stone-400 hover:text-green-600 cursor-pointer"
            >
              Done
            </button>
          )}
        </div>
      </div>

      {/* Row 2: assigned people */}
      <div className="ml-[22px] mt-0.5">
        <AssignDropdown
          owners={feature.owners}
          allPeople={allPeople}
          onChange={(owners) => onUpdate({ ...feature, owners })}
        />
      </div>
    </div>
  );
}
