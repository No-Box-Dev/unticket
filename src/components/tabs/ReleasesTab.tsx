import { useState, useMemo } from "react";
import { useAllFeatures, usePeople } from "@/hooks/useConfigRepo";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import { Rocket, ChevronLeft, ChevronRight, ExternalLink, Users } from "lucide-react";
import type { Feature } from "@/lib/types";

interface ShippedFeature extends Feature {
  shippedAt: string;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function ReleasesTab() {
  const { data: features, isLoading } = useAllFeatures();
  const { data: people } = usePeople();
  const nameOf = (login: string) => people?.find((p) => p.github === login)?.name ?? login;

  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Build map of date → shipped features
  const featuresByDate = useMemo(() => {
    if (!features) return new Map<string, ShippedFeature[]>();
    const map = new Map<string, ShippedFeature[]>();

    for (const f of features) {
      if (f.status !== "production") continue;
      const prodEntries = (f.statusHistory ?? []).filter((h) => h.status === "production");
      // Use statusHistory timestamp, or fall back to updatedAt (last modified date from GitHub)
      const shippedAt = prodEntries.length > 0
        ? prodEntries[prodEntries.length - 1].timestamp
        : (f.updatedAt ?? new Date().toISOString());
      const key = toDateKey(new Date(shippedAt));
      const arr = map.get(key) ?? [];
      arr.push({ ...f, shippedAt });
      map.set(key, arr);
    }

    return map;
  }, [features]);

  // Calendar grid for current month
  const calendarDays = useMemo(() => {
    const { year, month } = viewMonth;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // Monday-based week: getDay() returns 0=Sun, we want 0=Mon
    const startOffset = (firstDay.getDay() + 6) % 7;
    const days: (Date | null)[] = [];

    // Pad start with nulls
    for (let i = 0; i < startOffset; i++) days.push(null);
    // Fill days
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push(new Date(year, month, d));
    }
    // Pad end to complete the last week
    while (days.length % 7 !== 0) days.push(null);

    return days;
  }, [viewMonth]);

  const today = new Date();
  const totalShipped = featuresByDate.size > 0
    ? Array.from(featuresByDate.values()).reduce((sum, arr) => sum + arr.length, 0)
    : 0;

  const selectedFeatures = selectedDate ? (featuresByDate.get(selectedDate) ?? []) : [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-800 dark:text-neutral-200 font-display">Releases</h2>
          <p className="text-xs text-stone-400 dark:text-neutral-500 mt-0.5">
            {totalShipped} feature{totalShipped !== 1 ? "s" : ""} shipped
          </p>
        </div>
      </div>

      {/* Month navigation */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setViewMonth((m) => m.month === 0 ? { year: m.year - 1, month: 11 } : { ...m, month: m.month - 1 })}
          className="p-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-white/[0.06] transition-colors"
        >
          <ChevronLeft size={16} className="text-stone-500 dark:text-neutral-400" />
        </button>
        <span className="text-sm font-semibold text-stone-800 dark:text-neutral-200 min-w-[140px] text-center">
          {MONTH_NAMES[viewMonth.month]} {viewMonth.year}
        </span>
        <button
          onClick={() => setViewMonth((m) => m.month === 11 ? { year: m.year + 1, month: 0 } : { ...m, month: m.month + 1 })}
          className="p-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-white/[0.06] transition-colors"
        >
          <ChevronRight size={16} className="text-stone-500 dark:text-neutral-400" />
        </button>
        <button
          onClick={() => {
            const now = new Date();
            setViewMonth({ year: now.getFullYear(), month: now.getMonth() });
          }}
          className="ml-2 px-2.5 py-1 text-xs font-medium text-stone-500 dark:text-neutral-400 bg-stone-100 dark:bg-dark-overlay rounded-lg hover:bg-stone-200 dark:hover:bg-white/[0.1] transition-colors"
        >
          Today
        </button>
      </div>

      {/* Calendar grid */}
      <div className="bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-stone-100 dark:border-white/[0.06]">
          {WEEKDAYS.map((day) => (
            <div key={day} className="px-2 py-2 text-center text-[10px] font-semibold text-stone-400 dark:text-neutral-500 uppercase tracking-wider">
              {day}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {calendarDays.map((date, i) => {
            if (!date) {
              return <div key={`empty-${i}`} className="min-h-[100px] bg-stone-50/50 dark:bg-white/[0.01] border-b border-r border-stone-100 dark:border-white/[0.04]" />;
            }

            const key = toDateKey(date);
            const shipped = featuresByDate.get(key) ?? [];
            const isToday = isSameDay(date, today);
            const isSelected = selectedDate === key;
            const hasShips = shipped.length > 0;

            return (
              <button
                key={key}
                onClick={() => setSelectedDate(isSelected ? null : key)}
                className={cn(
                  "min-h-[100px] p-1.5 border-b border-r border-stone-100 dark:border-white/[0.04] text-left transition-colors relative",
                  isSelected
                    ? "bg-brand/5 dark:bg-brand/10"
                    : hasShips
                      ? "hover:bg-green-50 dark:hover:bg-green-950/30"
                      : "hover:bg-stone-50 dark:hover:bg-white/[0.02]",
                )}
              >
                <span className={cn(
                  "text-xs font-medium inline-flex items-center justify-center w-6 h-6 rounded-full",
                  isToday && "bg-brand text-white",
                  !isToday && "text-stone-600 dark:text-neutral-400",
                )}>
                  {date.getDate()}
                </span>
                {hasShips && (
                  <div className="mt-1 space-y-0.5">
                    {shipped.map((f) => (
                      <a
                        key={f.id}
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-start gap-1 px-1 py-0.5 bg-green-100 dark:bg-green-900/40 rounded text-[10px] text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-800/50 transition-colors"
                      >
                        <Rocket size={9} className="shrink-0 mt-0.5" />
                        <span>{f.title}</span>
                      </a>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected day detail */}
      {selectedDate && (
        <div className="bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-neutral-200 mb-3">
            {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            <span className="ml-2 text-xs font-normal text-stone-400 dark:text-neutral-500">
              {selectedFeatures.length} feature{selectedFeatures.length !== 1 ? "s" : ""} shipped
            </span>
          </h3>
          {selectedFeatures.length === 0 ? (
            <p className="text-xs text-stone-400 dark:text-neutral-500">No features shipped on this day</p>
          ) : (
            <div className="space-y-2">
              {selectedFeatures.map((f) => (
                <div
                  key={f.id}
                  className="flex items-start gap-3 p-3 rounded-lg border border-stone-100 dark:border-white/[0.06] hover:border-stone-200 dark:hover:border-white/[0.1] transition-colors"
                >
                  <div className="p-1.5 bg-green-50 dark:bg-green-950 rounded-lg shrink-0 mt-0.5">
                    <Rocket size={14} className="text-green-600 dark:text-green-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-stone-800 dark:text-neutral-200 truncate">
                        {f.title}
                      </span>
                      {f.url && (
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-stone-400 hover:text-brand transition-colors shrink-0"
                        >
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                    {f.owners.length > 0 && (
                      <span className="flex items-center gap-1 text-xs text-stone-400 dark:text-neutral-500 mt-1">
                        <Users size={11} />
                        {f.owners.map(nameOf).join(", ")}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
