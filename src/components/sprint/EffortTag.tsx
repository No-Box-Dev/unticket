import { cn } from "@/lib/cn";
import type { Effort } from "@/lib/types";

const effortConfig: Record<Effort, { label: string; bg: string; text: string }> = {
  low: { label: "Low", bg: "bg-green-50", text: "text-green-700" },
  medium: { label: "Med", bg: "bg-amber-50", text: "text-amber-700" },
  high: { label: "High", bg: "bg-red-50", text: "text-red-700" },
};

const cycle: Effort[] = ["low", "medium", "high"];

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
        "px-2 py-0.5 text-[10px] font-medium rounded-full cursor-pointer transition-colors",
        config.bg,
        config.text,
      )}
      title="Click to cycle effort"
    >
      {config.label}
    </button>
  );
}
