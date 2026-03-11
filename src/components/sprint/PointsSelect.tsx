import { cn } from "@/lib/cn";
import type { Points } from "@/lib/types";
import { VALID_POINTS } from "@/lib/types";

interface PointsSelectProps {
  value?: Points;
  onChange: (points: Points) => void;
  size?: "sm" | "md";
}

export function PointsSelect({ value, onChange, size = "sm" }: PointsSelectProps) {
  return (
    <div className="flex items-center gap-0.5">
      {VALID_POINTS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          className={cn(
            "rounded font-medium cursor-pointer transition-colors",
            size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs",
            value === p
              ? "bg-brand text-white"
              : "bg-stone-100 dark:bg-dark-overlay text-stone-500 dark:text-neutral-400 hover:bg-stone-200 dark:hover:bg-white/[0.1]",
          )}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

interface PointsBadgeProps {
  points: number;
  total?: number;
  size?: "sm" | "md";
}

export function PointsBadge({ points, total, size = "sm" }: PointsBadgeProps) {
  const display = total !== undefined ? `${points}/${total} pts` : `${points} pts`;
  return (
    <span
      className={cn(
        "font-medium rounded-full",
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
        "bg-purple-50 text-purple-600 dark:bg-purple-950 dark:text-purple-400",
      )}
    >
      {display}
    </span>
  );
}
