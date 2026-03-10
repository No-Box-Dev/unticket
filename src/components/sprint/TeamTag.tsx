import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/cn";

interface TeamTagProps {
  team?: string;
  teams: string[];
  onChange: (team: string | undefined) => void;
}

export function TeamTag({ team, teams, onChange }: TeamTagProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "px-2.5 py-0.5 text-xs font-medium rounded-full cursor-pointer transition-colors border",
          team
            ? "bg-brand/10 text-brand border-brand/20"
            : "bg-stone-50 dark:bg-stone-800/50 text-stone-400 dark:text-stone-500 border-stone-200 dark:border-stone-700",
        )}
      >
        {team || "Team"}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 left-0 bg-white dark:bg-stone-900 rounded-lg shadow-md border border-stone-200 dark:border-stone-700 py-1 min-w-[120px]">
          <button
            onClick={() => { onChange(undefined); setOpen(false); }}
            className={cn(
              "w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 dark:hover:bg-stone-800/50 cursor-pointer",
              !team ? "text-brand font-medium" : "text-stone-500 dark:text-stone-400",
            )}
          >
            None
          </button>
          {teams.map((t) => (
            <button
              key={t}
              onClick={() => { onChange(t); setOpen(false); }}
              className={cn(
                "w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 dark:hover:bg-stone-800/50 cursor-pointer",
                team === t ? "text-brand font-medium" : "text-stone-600 dark:text-stone-400",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
