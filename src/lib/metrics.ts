import type { WeeklyBucket, MetricData } from "./types";

function getWeekStart(date: Date): string {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split("T")[0];
}

function buildWeeklyBuckets(dates: string[], weeks: number): WeeklyBucket[] {
  const now = new Date();
  const buckets: Map<string, number> = new Map();

  // Initialize empty buckets for last N weeks
  for (let i = 0; i < weeks; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    buckets.set(getWeekStart(d), 0);
  }

  // Fill buckets
  for (const dateStr of dates) {
    const weekStart = getWeekStart(new Date(dateStr));
    if (buckets.has(weekStart)) {
      buckets.set(weekStart, (buckets.get(weekStart) ?? 0) + 1);
    }
  }

  return Array.from(buckets.entries())
    .map(([weekStart, value]) => ({ weekStart, value }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

function getDay(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split("T")[0];
}

function buildDailyBuckets(dates: string[], days: number): WeeklyBucket[] {
  const now = new Date();
  const buckets: Map<string, number> = new Map();

  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    buckets.set(getDay(d), 0);
  }

  for (const dateStr of dates) {
    const day = getDay(new Date(dateStr));
    if (buckets.has(day)) {
      buckets.set(day, (buckets.get(day) ?? 0) + 1);
    }
  }

  return Array.from(buckets.entries())
    .map(([weekStart, value]) => ({ weekStart, value }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export function computeMetric(dates: string[], weeks = 10): MetricData {
  const history = buildWeeklyBuckets(dates, weeks);
  const current = history.length > 0 ? history[history.length - 1].value : 0;
  const previous = history.length > 1 ? history[history.length - 2].value : 0;
  return { current, previous, change: current - previous, history };
}

export function computeMetricDaily(dates: string[], days: number): MetricData {
  const history = buildDailyBuckets(dates, days);
  const current = history.length > 0 ? history[history.length - 1].value : 0;
  const previous = history.length > 1 ? history[history.length - 2].value : 0;
  return { current, previous, change: current - previous, history };
}

// Compute cumulative metric (e.g., issues remaining = snapshot each week)
export function computeCumulativeMetric(
  weeklySnapshots: { weekStart: string; value: number }[],
): MetricData {
  const sorted = [...weeklySnapshots].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const current = sorted.length > 0 ? sorted[sorted.length - 1].value : 0;
  const previous = sorted.length > 1 ? sorted[sorted.length - 2].value : 0;
  return { current, previous, change: current - previous, history: sorted };
}

// Helper: extract dates from PRs/issues for metric bucketing
export function extractMergedDates(prs: { merged_at?: string | null }[]): string[] {
  return prs.filter((pr) => pr.merged_at).map((pr) => pr.merged_at!);
}

export function extractClosedDates(issues: { closed_at?: string | null }[]): string[] {
  return issues.filter((i) => i.closed_at).map((i) => i.closed_at!);
}

export function extractCreatedDates(items: { created_at: string }[]): string[] {
  return items.map((i) => i.created_at);
}

// ---------- Ref tab helpers ----------

export const EFFORT_POINTS: Record<string, number> = { low: 1, medium: 2, high: 3 };

import type { Feature, SprintConfig, StatusHistoryEntry } from "./types";

/** Compute burndown data for a sprint: ideal line + actual remaining features per day. */
export function computeBurndown(
  features: Feature[],
  sprint: SprintConfig,
): { ideal: { x: number; y: number }[]; actual: { x: number; y: number }[] } {
  const start = new Date(sprint.startDate + "T00:00:00");
  const end = new Date(sprint.endDate + "T23:59:59");
  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
  const total = features.length;

  const ideal: { x: number; y: number }[] = [];
  for (let d = 0; d <= totalDays; d++) {
    ideal.push({ x: d, y: Math.round(total - (total / totalDays) * d) });
  }

  const now = new Date();
  const daysElapsed = Math.min(totalDays, Math.max(0, Math.round((now.getTime() - start.getTime()) / 86400000)));

  const actual: { x: number; y: number }[] = [];
  for (let d = 0; d <= daysElapsed; d++) {
    const dayDate = new Date(start.getTime() + d * 86400000);
    const remaining = features.filter((f) => {
      if (f.status !== "production") return true;
      // Check statusHistory for when it became production
      const prodEntry = f.statusHistory?.find((h: StatusHistoryEntry) => h.status === "production");
      if (!prodEntry) return false; // is production but no history — assume done before sprint
      return new Date(prodEntry.timestamp) > dayDate;
    }).length;
    actual.push({ x: d, y: remaining });
  }

  return { ideal, actual };
}

/** Compute engineer status relative to sprint progress. */
export function computeEngineerStatus(
  personFeatures: Feature[],
  sprint: SprintConfig,
): "on-track" | "at-risk" | "behind" {
  if (personFeatures.length === 0) return "on-track";

  const completed = personFeatures.filter((f) => f.status === "production").length;
  const total = personFeatures.length;
  const completionPct = completed / total;

  const now = new Date();
  const start = new Date(sprint.startDate + "T00:00:00");
  const end = new Date(sprint.endDate + "T23:59:59");
  const elapsed = Math.max(0, now.getTime() - start.getTime());
  const duration = Math.max(1, end.getTime() - start.getTime());
  const elapsedPct = Math.min(1, elapsed / duration);

  const diff = completionPct - elapsedPct;
  if (diff >= -0.1) return "on-track";
  if (diff >= -0.3) return "at-risk";
  return "behind";
}

// Build open issues weekly snapshots from created/closed dates
export function buildOpenIssueSnapshots(
  allIssues: { created_at: string; closed_at?: string | null; state: string }[],
  weeks: number,
): WeeklyBucket[] {
  const now = new Date();
  const buckets: WeeklyBucket[] = [];

  for (let i = weeks - 1; i >= 0; i--) {
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() - i * 7);
    const weekStart = getWeekStart(weekEnd);

    const openCount = allIssues.filter((issue) => {
      const created = new Date(issue.created_at);
      if (created > weekEnd) return false;
      if (issue.closed_at) {
        const closed = new Date(issue.closed_at);
        return closed > weekEnd;
      }
      return true;
    }).length;

    buckets.push({ weekStart, value: openCount });
  }

  return buckets;
}
