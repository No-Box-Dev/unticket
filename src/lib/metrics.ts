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

export function computeMetric(dates: string[], weeks = 10): MetricData {
  const history = buildWeeklyBuckets(dates, weeks);
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
