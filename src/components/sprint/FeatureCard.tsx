import { cn } from "@/lib/cn";
import { EffortTag } from "./EffortTag";
import { PriorityTag } from "./PriorityTag";
import { AssignDropdown } from "./AssignDropdown";
import type { Feature, Effort, Priority } from "@/lib/types";
import { GripVertical } from "lucide-react";

interface FeatureCardProps {
  feature: Feature;
  allPeople: string[];
  onUpdate: (updated: Feature) => void;
  onDelete: (id: string) => void;
  onOpenDetail: (feature: Feature) => void;
  mode: "sprint" | "backlog";
  currentSprint?: number;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, feature: Feature) => void;
}

export function FeatureCard({
  feature,
  allPeople,
  onUpdate,
  onDelete,
  onOpenDetail,
  mode,
  currentSprint,
  draggable,
  onDragStart,
}: FeatureCardProps) {
  const dotColor =
    feature.status === "production"
      ? "bg-green-500"
      : feature.status === "demo"
        ? "bg-amber-500"
        : feature.status === "plan"
          ? "bg-brand"
          : "bg-stone-300";

  return (
    <div
      draggable={draggable}
      onDragStart={(e) => onDragStart?.(e, feature)}
      className={cn(
        "group bg-white rounded-lg border border-stone-200 p-3 shadow-sm hover:shadow-md transition-shadow",
        draggable && "cursor-grab active:cursor-grabbing",
        feature.status === "production" && "opacity-60",
      )}
    >
      {/* Row 1: grip + title */}
      <div className="flex items-start gap-2">
        {draggable && (
          <GripVertical className="w-4 h-4 text-stone-300 mt-0.5 shrink-0" />
        )}
        <button
          onClick={() => onOpenDetail(feature)}
          className="text-sm font-medium text-stone-800 text-left cursor-pointer hover:text-brand leading-snug"
        >
          {feature.title}
        </button>
      </div>

      {/* Row 2: tags + people + hover actions */}
      <div className="flex items-center gap-2 mt-1.5 ml-6">
        <span className={cn("w-2 h-2 rounded-full shrink-0", dotColor)} />
        <PriorityTag
          priority={feature.priority ?? "none"}
          onChange={(priority: Priority) => onUpdate({ ...feature, priority })}
        />
        <EffortTag
          effort={feature.effort}
          onChange={(effort: Effort) => onUpdate({ ...feature, effort })}
        />
        <AssignDropdown
          owners={feature.owners}
          allPeople={allPeople}
          onChange={(owners) => onUpdate({ ...feature, owners })}
        />
        <div className="flex-1" />
        <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
          {mode === "sprint" && (
            <button
              onClick={() => onUpdate({ ...feature, status: "future", sprint: null })}
              className="text-[11px] text-stone-400 hover:text-stone-600 cursor-pointer"
            >
              Backlog
            </button>
          )}
          {mode === "backlog" && currentSprint && (
            <button
              onClick={() => onUpdate({ ...feature, sprint: currentSprint, status: "plan" })}
              className="text-[11px] text-stone-400 hover:text-brand cursor-pointer"
            >
              Sprint
            </button>
          )}
          <button
            onClick={() => onDelete(feature.id)}
            className="text-[11px] text-stone-400 hover:text-red-500 cursor-pointer"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
