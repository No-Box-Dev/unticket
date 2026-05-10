import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
  loading?: boolean;
  className?: string;
}

export function StatCard({ label, value, icon, loading, className }: StatCardProps) {
  return (
    <div
      className={cn(
        "bg-white rounded-xl border border-stone-200 p-4 flex items-center gap-3",
        className,
      )}
    >
      <div className="w-10 h-10 rounded-lg bg-accent-soft flex items-center justify-center text-accent shrink-0">
        {icon}
      </div>
      <div>
        <div className="text-2xl font-bold text-stone-900">
          {loading ? (
            <div className="w-8 h-6 bg-stone-100 rounded animate-pulse" />
          ) : (
            value
          )}
        </div>
        <div className="text-xs text-stone-500">{label}</div>
      </div>
    </div>
  );
}
