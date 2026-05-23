import { cn } from "@/lib/cn";
import { AssignDropdown } from "./AssignDropdown";
import { withStatusTransition } from "@/lib/github-features";
import type { BoardStage, Feature, FeatureStatus } from "@/lib/types";
import { GripVertical, Trash2, GitPullRequest } from "lucide-react";

interface FeatureCardProps {
  feature: Feature;
  stages: BoardStage[];
  allPeople: string[];
  onUpdate: (updated: Feature) => void;
  onDelete: (id: number) => void;
  onOpenDetail: (feature: Feature) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, feature: Feature) => void;
  isAdmin?: boolean;
}

export function FeatureCard({
  feature,
  stages,
  allPeople,
  onUpdate,
  onDelete,
  onOpenDetail,
  draggable,
  onDragStart,
  isAdmin,
}: FeatureCardProps) {
  const hasPlan = !!feature.plan?.trim();
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

  const currentStage = stages.find((s) => s.id === feature.status);
  const dotColor = currentStage?.color ?? "#d6d3d1"; // stone-300 fallback
  const isLastStage = stages.length > 0 && stages[stages.length - 1].id === feature.status;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!draggable) return;
    const idx = stages.findIndex((s) => s.id === feature.status);
    if (idx === -1) return;
    let targetStatus: FeatureStatus | null = null;
    if (e.key === "ArrowRight" && idx < stages.length - 1) targetStatus = stages[idx + 1].id;
    if (e.key === "ArrowLeft" && idx > 0) targetStatus = stages[idx - 1].id;
    if (targetStatus) {
      e.preventDefault();
      onUpdate(withStatusTransition(feature, targetStatus));
    }
  };

  return (
    <div
      draggable={draggable}
      onDragStart={(e) => onDragStart?.(e, feature)}
      onKeyDown={handleKeyDown}
      role="listitem"
      aria-label={`${feature.title}, status: ${feature.status}`}
      tabIndex={draggable ? 0 : undefined}
      className={cn(
        "group bg-white  rounded-lg border border-stone-200  p-3 shadow-sm hover:shadow-md transition-shadow",
        draggable && "cursor-grab active:cursor-grabbing",
        isLastStage && "opacity-60",
        !hasPlan && "border-l-2 border-l-amber-300",
      )}
    >
      {/* Row 1: grip + title */}
      <div className="flex items-start gap-2">
        {draggable && (
          <GripVertical className="w-4 h-4 text-stone-300 mt-0.5 shrink-0" />
        )}
        <button
          onClick={() => onOpenDetail(feature)}
          className="text-sm font-medium text-stone-800 text-left cursor-pointer hover:text-accent leading-snug"
        >
          {feature.title}
        </button>
      </div>

      {/* Row 2: tags + people + hover actions */}
      <div className="flex items-center gap-2 mt-1.5 ml-6 flex-wrap">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: dotColor }}
        />
        {feature.linkedPRs && feature.linkedPRs.length > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-stone-400 bg-stone-100 rounded-full px-1.5 py-0">
            <GitPullRequest className="w-2.5 h-2.5" />
            {feature.linkedPRs.length}
          </span>
        )}
        <AssignDropdown
          owners={feature.owners}
          allPeople={allPeople}
          onChange={(owners) => onUpdate({ ...feature, owners })}
        />
        <div className="flex-1 min-w-0" />
        <div className="flex items-center gap-1.5">
          {isAdmin && (
            <button
              onClick={stop(() => onDelete(feature.id))}
              className="p-1 text-stone-300 hover:text-red-500 cursor-pointer rounded hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
