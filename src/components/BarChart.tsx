import { useState } from "react";
import type { WeeklyBucket } from "@/lib/types";

interface BarChartProps {
  data: WeeklyBucket[];
  color: string;
  onBarClick?: (weekStart: string) => void;
  activeWeek?: string | null;
  daily?: boolean;
}

function formatWeek(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDay(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
}

function shouldShowLabel(i: number, total: number) {
  if (total <= 6) return true;
  if (i === 0 || i === total - 1) return true;
  if (total <= 12) return i % 2 === 0;
  const step = Math.ceil(total / 5);
  return i % step === 0;
}

export function BarChart({ data, color, onBarClick, activeWeek, daily }: BarChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (data.length === 0) return null;

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const clickable = !!onBarClick;

  return (
    <div className="w-full">
      <div className="flex items-end gap-[2px]" style={{ height: 100 }}>
        {data.map((bucket, i) => {
          const heightPct = bucket.value === 0 ? 1 : (bucket.value / maxValue) * 100;
          const isHovered = hovered === i;
          const isActive = activeWeek === bucket.weekStart;

          return (
            <div
              key={bucket.weekStart}
              className="relative flex-1 flex flex-col justify-end h-full"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onBarClick?.(bucket.weekStart)}
              style={{ cursor: clickable ? "pointer" : undefined }}
            >
              {isHovered && bucket.value > 0 && (
                <div
                  className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-semibold whitespace-nowrap"
                  style={{ color }}
                >
                  {bucket.value}
                </div>
              )}
              <div
                className="w-full rounded-sm transition-opacity"
                style={{
                  height: `${heightPct}%`,
                  minHeight: 2,
                  backgroundColor: color,
                  opacity: isActive ? 1 : isHovered ? 0.9 : 0.6,
                  outline: isActive ? `2px solid ${color}` : undefined,
                  outlineOffset: 1,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-[2px] mt-1">
        {data.map((bucket, i) => (
          <div key={bucket.weekStart} className="flex-1 text-center">
            {shouldShowLabel(i, data.length) && (
              <span className="text-[9px] text-stone-400 leading-none">
                {daily ? formatDay(bucket.weekStart) : formatWeek(bucket.weekStart)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
