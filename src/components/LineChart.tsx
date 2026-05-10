import { useState } from "react";

interface LineData {
  data: { x: number; y: number }[];
  color: string;
  dashed?: boolean;
  label: string;
}

interface LineChartProps {
  lines: LineData[];
  height?: number;
  xLabel?: (x: number) => string;
}

export function LineChart({ lines, height = 200, xLabel }: LineChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (lines.length === 0 || lines.every((l) => l.data.length === 0)) return null;

  const allPoints = lines.flatMap((l) => l.data);
  const maxX = Math.max(...allPoints.map((p) => p.x), 1);
  const maxY = Math.max(...allPoints.map((p) => p.y), 1);

  const padL = 36;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const w = 500;
  const plotW = w - padL - padR;
  const plotH = height - padT - padB;

  const toX = (x: number) => padL + (x / maxX) * plotW;
  const toY = (y: number) => padT + plotH - (y / maxY) * plotH;

  // Y-axis ticks
  const yTicks: number[] = [];
  const step = Math.max(1, Math.ceil(maxY / 4));
  for (let v = 0; v <= maxY; v += step) yTicks.push(v);

  // X-axis ticks
  const xTicks: number[] = [];
  const xStep = Math.max(1, Math.ceil(maxX / 6));
  for (let v = 0; v <= maxX; v += xStep) xTicks.push(v);

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${w} ${height}`}
        className="w-full"
        onMouseLeave={() => setHovered(null)}
      >
        {/* Grid lines */}
        {yTicks.map((v) => (
          <g key={`y-${v}`}>
            <line x1={padL} x2={w - padR} y1={toY(v)} y2={toY(v)} className="stroke-stone-200" strokeWidth={1} />
            <text x={padL - 6} y={toY(v) + 4} textAnchor="end" className="fill-stone-400 text-[10px]">
              {v}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {xTicks.map((v) => (
          <text key={`x-${v}`} x={toX(v)} y={height - 4} textAnchor="middle" className="fill-stone-400 text-[10px]">
            {xLabel ? xLabel(v) : `Day ${v}`}
          </text>
        ))}

        {/* Lines */}
        {lines.map((line) => {
          if (line.data.length < 2) return null;
          const sorted = [...line.data].sort((a, b) => a.x - b.x);
          const pathD = sorted.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.x)} ${toY(p.y)}`).join(" ");
          return (
            <path
              key={line.label}
              d={pathD}
              fill="none"
              stroke={line.color}
              strokeWidth={2}
              strokeDasharray={line.dashed ? "6 4" : undefined}
            />
          );
        })}

        {/* Dots on actual line (first non-dashed) */}
        {lines
          .filter((l) => !l.dashed)
          .map((line) =>
            line.data.map((p, i) => (
              <circle
                key={`${line.label}-${i}`}
                cx={toX(p.x)}
                cy={toY(p.y)}
                r={hovered === i ? 4 : 2.5}
                fill={line.color}
                onMouseEnter={() => setHovered(i)}
                className="cursor-pointer"
              />
            )),
          )}

        {/* Tooltip */}
        {hovered !== null &&
          lines
            .filter((l) => !l.dashed)
            .map((line) => {
              const pt = line.data.find((p) => p.x === hovered) ?? line.data[hovered];
              if (!pt) return null;
              return (
                <text
                  key={`tip-${line.label}`}
                  x={toX(pt.x)}
                  y={toY(pt.y) - 10}
                  textAnchor="middle"
                  className="fill-stone-700 text-[11px] font-semibold"
                >
                  {pt.y}
                </text>
              );
            })}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 justify-center">
        {lines.map((line) => (
          <div key={line.label} className="flex items-center gap-1.5 text-xs text-stone-500">
            <div
              className="w-4 h-0.5"
              style={{
                backgroundColor: line.color,
                borderTop: line.dashed ? `2px dashed ${line.color}` : undefined,
                height: line.dashed ? 0 : 2,
              }}
            />
            {line.label}
          </div>
        ))}
      </div>
    </div>
  );
}
