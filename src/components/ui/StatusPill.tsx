import { cn } from "@/lib/cn";
import { STATUS_COLORS, STATUS_LABELS, TODO_STATUS_DOTS, type FeatureStatus, type TodoStatus } from "@/lib/types";

type AnyStatus = FeatureStatus | TodoStatus;

interface Props {
  status: AnyStatus;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

const TODO_LABELS: Record<TodoStatus, string> = {
  backlog: "Backlog",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

function dotClass(status: AnyStatus): string {
  if (status in STATUS_COLORS) return STATUS_COLORS[status as FeatureStatus];
  return TODO_STATUS_DOTS[status as TodoStatus] ?? "bg-stone-400";
}

function statusLabel(status: AnyStatus): string {
  if (status in STATUS_LABELS) return STATUS_LABELS[status as FeatureStatus];
  return TODO_LABELS[status as TodoStatus] ?? String(status);
}

export function StatusPill({ status, label, size = "sm", className }: Props) {
  const text = label ?? statusLabel(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-stone-100 text-stone-700 font-medium",
        size === "sm" ? "text-[11px] px-2 py-0.5" : "text-xs px-2.5 py-1",
        className,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotClass(status))} />
      <span className="truncate">{text}</span>
    </span>
  );
}

export function StatusDot({ status, className }: { status: AnyStatus; className?: string }) {
  return <span className={cn("w-2 h-2 rounded-full shrink-0", dotClass(status), className)} />;
}
