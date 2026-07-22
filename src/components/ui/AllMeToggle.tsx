import { cn } from "@/lib/cn";

interface AllMeToggleProps {
  me: boolean;
  onChange: (me: boolean) => void;
  className?: string;
}

/** Compact, shared ownership scope control used by content tabs. */
export function AllMeToggle({ me, onChange, className }: AllMeToggleProps) {
  return (
    <div
      className={cn("inline-flex rounded-lg border border-stone-200 overflow-hidden bg-white", className)}
      role="group"
      aria-label="Content scope"
    >
      <button
        type="button"
        aria-pressed={!me}
        onClick={() => onChange(false)}
        className={cn(
          "px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer",
          !me ? "bg-accent text-white" : "text-stone-600 hover:bg-stone-50",
        )}
      >
        All
      </button>
      <button
        type="button"
        aria-pressed={me}
        onClick={() => onChange(true)}
        className={cn(
          "px-2.5 py-1.5 text-xs font-medium border-l border-stone-200 transition-colors cursor-pointer",
          me ? "bg-accent text-white" : "text-stone-600 hover:bg-stone-50",
        )}
      >
        Me
      </button>
    </div>
  );
}
