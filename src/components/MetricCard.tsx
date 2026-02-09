import { Sparkline } from "./Sparkline";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { MetricData } from "@/lib/types";

interface MetricCardProps {
  title: string;
  metric: MetricData;
  color: string;
  invertTrend?: boolean; // true = decrease is good (e.g., issues remaining)
}

export function MetricCard({ title, metric, color, invertTrend }: MetricCardProps) {
  const isPositive = invertTrend ? metric.change < 0 : metric.change > 0;
  const isNeutral = metric.change === 0;

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4">
      <div className="text-xs font-medium text-stone-500 uppercase tracking-wider mb-2">
        {title}
      </div>
      <div className="flex items-end justify-between mb-3">
        <span className="text-3xl font-semibold text-stone-800" style={{ color }}>
          {metric.current}
        </span>
        {!isNeutral ? (
          <span
            className={`flex items-center gap-0.5 text-xs font-medium ${
              isPositive ? "text-green-600" : "text-red-500"
            }`}
          >
            {metric.change > 0 ? (
              <TrendingUp className="w-3 h-3" />
            ) : (
              <TrendingDown className="w-3 h-3" />
            )}
            {metric.change > 0 ? "+" : ""}
            {metric.change} from last wk
          </span>
        ) : (
          <span className="flex items-center gap-0.5 text-xs text-stone-400">
            <Minus className="w-3 h-3" />
            No change
          </span>
        )}
      </div>
      <Sparkline data={metric.history} color={color} width={240} height={56} labels />
    </div>
  );
}
