import { Flag } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Priority } from "@/lib/types";

const priorityConfig: Record<Priority, { color: string; fill: boolean }> = {
  high: { color: "text-red-500", fill: true },
  medium: { color: "text-orange-400", fill: true },
  low: { color: "text-green-500", fill: true },
  none: { color: "text-stone-300", fill: false },
};

const cycle: Priority[] = ["none", "low", "medium", "high"];

interface PriorityTagProps {
  priority: Priority;
  onChange: (priority: Priority) => void;
}

export function PriorityTag({ priority, onChange }: PriorityTagProps) {
  const config = priorityConfig[priority];
  const next = () => {
    const idx = cycle.indexOf(priority);
    onChange(cycle[(idx + 1) % cycle.length]);
  };

  return (
    <button
      onClick={next}
      className={cn(
        "p-1 cursor-pointer transition-colors hover:opacity-70",
        config.color,
      )}
      title={`Priority: ${priority}`}
    >
      <Flag className="w-3.5 h-3.5" fill={config.fill ? "currentColor" : "none"} />
    </button>
  );
}
