import { cn } from "@/lib/cn";
import { TeamTag } from "./TeamTag";
import { PriorityTag } from "./PriorityTag";
import { AssignDropdown } from "./AssignDropdown";
import { withStatusTransition } from "@/lib/github-features";
import type { Feature, Priority } from "@/lib/types";
import { GripVertical, Archive, ArrowUpFromLine, Trash2 } from "lucide-react";

interface FeatureCardProps {
  feature: Feature;
  allPeople: string[];
  allTeams: string[];
  onUpdate: (updated: Feature) => void;
  onDelete: (id: number) => void;
  onOpenDetail: (feature: Feature) => void;
  mode: "sprint" | "backlog";
  currentSprint?: number;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, feature: Feature) => void;
  isAdmin?: boolean;
}

export function FeatureCard({
  feature,
  allPeople,
  allTeams,
  onUpdate,
  onDelete,
  onOpenDetail,
  mode,
  currentSprint,
  draggable,
  onDragStart,
  isAdmin,
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
        <TeamTag
          team={feature.team}
          teams={allTeams}
          onChange={(team) => onUpdate({ ...feature, team })}
        />
        <AssignDropdown
          owners={feature.owners}
          allPeople={allPeople}
          onChange={(owners) => onUpdate({ ...feature, owners })}
        />
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {mode === "sprint" && (
            <button
              onClick={() => onUpdate({ ...withStatusTransition(feature, "future"), sprint: null })}
              className="p-1 text-stone-400 hover:text-stone-600 cursor-pointer rounded hover:bg-stone-100"
              title="Move to Backlog"
            >
              <Archive size={13} />
            </button>
          )}
          {mode === "backlog" && currentSprint && (
            <button
              onClick={() => onUpdate({ ...withStatusTransition(feature, "plan"), sprint: currentSprint })}
              className="p-1 text-stone-400 hover:text-brand cursor-pointer rounded hover:bg-stone-100"
              title="Move to Sprint"
            >
              <ArrowUpFromLine size={13} />
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => onDelete(feature.id)}
              className="p-1 text-stone-400 hover:text-red-500 cursor-pointer rounded hover:bg-red-50"
              title="Delete"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
