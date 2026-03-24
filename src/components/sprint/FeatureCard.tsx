import { cn } from "@/lib/cn";
import { AssignDropdown } from "./AssignDropdown";
import { withStatusTransition } from "@/lib/github-features";
import type { Feature, FeatureStatus } from "@/lib/types";
import { GripVertical, Archive, ArrowUpFromLine, Trash2 } from "lucide-react";

const STATUS_ORDER: FeatureStatus[] = ["plan", "in_progress", "demo", "tested", "production"];

interface FeatureCardProps {
  feature: Feature;
  allPeople: string[];
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
  onUpdate,
  onDelete,
  onOpenDetail,
  mode,
  currentSprint,
  draggable,
  onDragStart,
  isAdmin,
}: FeatureCardProps) {
  const hasPlan = !!feature.plan?.trim();
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

  const STATUS_COLORS: Record<string, string> = {
    plan: "bg-brand", in_progress: "bg-amber-500", demo: "bg-purple-500",
    tested: "bg-cyan-500", production: "bg-green-500", future: "bg-stone-300",
  };
  const dotColor = STATUS_COLORS[feature.status] ?? "bg-stone-300";

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!draggable || mode === "backlog") return;
    const idx = STATUS_ORDER.indexOf(feature.status);
    if (idx === -1) return;
    let targetStatus: FeatureStatus | null = null;
    if (e.key === "ArrowRight" && idx < STATUS_ORDER.length - 1) targetStatus = STATUS_ORDER[idx + 1];
    if (e.key === "ArrowLeft" && idx > 0) targetStatus = STATUS_ORDER[idx - 1];
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
        "group bg-white dark:bg-dark-raised rounded-lg border border-stone-200 dark:border-white/[0.06] p-3 shadow-sm hover:shadow-md transition-shadow",
        draggable && "cursor-grab active:cursor-grabbing",
        feature.status === "production" && "opacity-60",
        !hasPlan && "border-l-2 border-l-amber-300",
      )}
    >
      {/* Row 1: grip + title */}
      <div className="flex items-start gap-2">
        {draggable && (
          <GripVertical className="w-4 h-4 text-stone-300 dark:text-neutral-600 mt-0.5 shrink-0" />
        )}
        <button
          onClick={() => onOpenDetail(feature)}
          className="text-sm font-medium text-stone-800 dark:text-neutral-200 text-left cursor-pointer hover:text-brand leading-snug"
        >
          {feature.title}
        </button>
      </div>

      {/* Row 2: tags + people + hover actions */}
      <div className="flex items-center gap-2 mt-1.5 ml-6 flex-wrap">
        <span className={cn("w-2 h-2 rounded-full shrink-0", dotColor)} />
        <AssignDropdown
          owners={feature.owners}
          allPeople={allPeople}
          onChange={(owners) => onUpdate({ ...feature, owners })}
        />
        <div className="flex-1 min-w-0" />
        <div className="flex items-center gap-1.5">
          {mode === "sprint" && (
            <button
              onClick={stop(() => onUpdate({ ...withStatusTransition(feature, "future"), sprint: null }))}
              className="p-1 text-stone-300 dark:text-neutral-600 hover:text-stone-500 dark:hover:text-neutral-400 cursor-pointer rounded hover:bg-stone-100 dark:hover:bg-white/[0.06]"
              title="Move to Backlog"
            >
              <Archive size={13} />
            </button>
          )}
          {mode === "backlog" && currentSprint && (
            <button
              onClick={stop(() => onUpdate({ ...withStatusTransition(feature, "plan"), sprint: currentSprint }))}
              className="p-1 text-stone-300 dark:text-neutral-600 hover:text-brand cursor-pointer rounded hover:bg-stone-100 dark:hover:bg-white/[0.06]"
              title="Move to Sprint"
            >
              <ArrowUpFromLine size={13} />
            </button>
          )}
          {isAdmin && (
            <button
              onClick={stop(() => onDelete(feature.id))}
              className="p-1 text-stone-300 dark:text-neutral-600 hover:text-red-500 cursor-pointer rounded hover:bg-red-50 dark:hover:bg-red-950 opacity-0 group-hover:opacity-100 transition-opacity"
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
