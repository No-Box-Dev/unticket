import type { WeeklyBucket } from "@/lib/types";

interface SparklineProps {
  data: WeeklyBucket[];
  color: string;
  width?: number;
  height?: number;
  labels?: boolean;
}

export function Sparkline({
  data,
  color,
  width = 200,
  height = 48,
  labels = false,
}: SparklineProps) {
  if (data.length < 2) return null;

  const values = data.map((d) => d.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const padding = 4;
  const chartW = width - padding * 2;
  const chartH = height - (labels ? 16 : 0) - padding * 2;

  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * chartW;
    const y = padding + chartH - ((v - min) / range) * chartH;
    return `${x},${y}`;
  });

  const areaPoints = [
    `${padding},${padding + chartH}`,
    ...points,
    `${padding + chartW},${padding + chartH}`,
  ].join(" ");

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polygon points={areaPoints} fill={color} opacity={0.1} />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Current value dot */}
      {values.length > 0 && (
        <circle
          cx={padding + chartW}
          cy={padding + chartH - ((values[values.length - 1] - min) / range) * chartH}
          r={2.5}
          fill={color}
        />
      )}
      {labels && data.length >= 2 && (
        <>
          <text
            x={padding}
            y={height - 2}
            className="text-[9px] fill-stone-400"
          >
            {formatWeekLabel(data[0].weekStart)}
          </text>
          <text
            x={width - padding}
            y={height - 2}
            textAnchor="end"
            className="text-[9px] fill-stone-400"
          >
            {formatWeekLabel(data[data.length - 1].weekStart)}
          </text>
        </>
      )}
    </svg>
  );
}

function formatWeekLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
