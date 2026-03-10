import { cn } from "@/lib/cn";
import type { Effort } from "@/lib/types";

const effortConfig: Record<Effort, { label: string; bg: string; text: string; border: string }> = {
  low: { label: "Low", bg: "bg-green-50 dark:bg-green-950", text: "text-green-700 dark:text-green-400", border: "border-green-200 dark:border-green-800" },
  medium: { label: "Medium", bg: "bg-yellow-50 dark:bg-yellow-950", text: "text-yellow-700 dark:text-yellow-400", border: "border-yellow-200 dark:border-yellow-800" },
  high: { label: "High", bg: "bg-red-50 dark:bg-red-950", text: "text-red-600 dark:text-red-400", border: "border-red-200 dark:border-red-800" },
};

const cycle: Effort[] = ["medium", "low", "high"];

interface EffortTagProps {
  effort: Effort;
  onChange: (effort: Effort) => void;
}

export function EffortTag({ effort, onChange }: EffortTagProps) {
  const config = effortConfig[effort];
  const next = () => {
    const idx = cycle.indexOf(effort);
    onChange(cycle[(idx + 1) % cycle.length]);
  };

  return (
    <button
      onClick={next}
      className={cn(
        "px-2.5 py-0.5 text-xs font-medium rounded-full cursor-pointer transition-colors border",
        config.bg,
        config.text,
        config.border,
      )}
      title="Click to cycle effort"
    >
      {config.label}
    </button>
  );
}
