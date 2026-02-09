import { cn } from "@/lib/cn";
import type { Effort } from "@/lib/types";

const effortConfig: Record<Effort, { label: string; bg: string; text: string; border: string }> = {
  low: { label: "Low", bg: "bg-green-50", text: "text-green-700", border: "border-green-200" },
  medium: { label: "Effort", bg: "bg-transparent", text: "text-stone-400", border: "border-stone-300 border-dashed" },
  high: { label: "High", bg: "bg-red-50", text: "text-red-600", border: "border-red-200" },
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
        "px-2.5 py-0.5 text-[11px] font-medium rounded-full cursor-pointer transition-colors border",
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
