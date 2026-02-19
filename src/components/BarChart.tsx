import { useState } from "react";
import type { WeeklyBucket } from "@/lib/types";

interface BarChartProps {
  data: WeeklyBucket[];
  color: string;
}

export function BarChart({ data, color }: BarChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (data.length === 0) return null;

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const barCount = data.length;

  const padding = { top: 20, right: 4, bottom: 24, left: 4 };
  const chartHeight = 120;
  const svgHeight = chartHeight + padding.top + padding.bottom;

  // Gap between bars as fraction of bar width
  const gapRatio = 0.3;
  const totalBarWidthRatio = 1 / (1 + gapRatio);

  // Format week label: "Jan 5"
  function formatWeek(weekStart: string) {
    const d = new Date(weekStart + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  // Show labels for first, middle, last
  function shouldShowLabel(i: number) {
    if (barCount <= 5) return true;
    if (i === 0 || i === barCount - 1) return true;
    if (i === Math.floor(barCount / 2)) return true;
    return false;
  }

  return (
    <svg
      viewBox={`0 0 100 ${svgHeight}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height: svgHeight }}
    >
      {data.map((bucket, i) => {
        const slotWidth = (100 - padding.left - padding.right) / barCount;
        const barWidth = slotWidth * totalBarWidthRatio;
        const gap = slotWidth * gapRatio * 0.5;
        const x = padding.left + i * slotWidth + gap;
        const barHeight = (bucket.value / maxValue) * chartHeight;
        const y = padding.top + chartHeight - barHeight;
        const isHovered = hovered === i;

        return (
          <g
            key={bucket.weekStart}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            {/* Invisible hit area */}
            <rect
              x={padding.left + i * slotWidth}
              y={padding.top}
              width={slotWidth}
              height={chartHeight}
              fill="transparent"
            />
            {/* Bar */}
            <rect
              x={x}
              y={bucket.value === 0 ? padding.top + chartHeight - 1 : y}
              width={barWidth}
              height={bucket.value === 0 ? 1 : barHeight}
              rx={1}
              fill={color}
              opacity={isHovered ? 1 : 0.7}
              className="transition-opacity"
            />
            {/* Hover tooltip */}
            {isHovered && (
              <text
                x={x + barWidth / 2}
                y={y - 4}
                textAnchor="middle"
                fontSize="7"
                fontWeight="600"
                fill={color}
              >
                {bucket.value}
              </text>
            )}
            {/* X-axis label */}
            {shouldShowLabel(i) && (
              <text
                x={x + barWidth / 2}
                y={svgHeight - 4}
                textAnchor="middle"
                fontSize="5.5"
                fill="#a8a29e"
              >
                {formatWeek(bucket.weekStart)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
