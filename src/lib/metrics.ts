import type { WeeklyBucket, MetricData } from "./types";

function getWeekStart(date: Date): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  d.setUTCHours(0, 0, 0, 0);
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
  d.setUTCHours(0, 0, 0, 0);
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

// ---------- Overview dashboard helpers ----------

export interface Alert {
  icon: "stale" | "unreviewed" | "bottleneck" | "sprint-risk" | "backlog";
  label: string;
  count: number;
  severity: "amber" | "red";
  detail?: string;
}

export interface ContributorRow {
  login: string;
  prsMerged: number;
  issuesClosed: number;
  pointsDone: number;
}

/** Median cycle time (hours) for merged PRs, bucketed weekly. */
export function computeCycleTime(
  prs: { created_at: string; merged_at?: string | null }[],
  weeks: number,
): { median: number; history: WeeklyBucket[] } {
  const merged = prs.filter((p) => p.merged_at);
  const hours = merged.map(
    (p) => (new Date(p.merged_at!).getTime() - new Date(p.created_at).getTime()) / 3600000,
  );

  const median = hours.length > 0 ? computeMedian(hours) : 0;

  // Weekly buckets with median per week
  const now = new Date();
  const bucketMap = new Map<string, number[]>();
  for (let i = 0; i < weeks; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    bucketMap.set(getWeekStart(d), []);
  }

  for (const pr of merged) {
    const ws = getWeekStart(new Date(pr.merged_at!));
    if (bucketMap.has(ws)) {
      const h = (new Date(pr.merged_at!).getTime() - new Date(pr.created_at).getTime()) / 3600000;
      bucketMap.get(ws)!.push(h);
    }
  }

  const history: WeeklyBucket[] = Array.from(bucketMap.entries())
    .map(([weekStart, vals]) => ({
      weekStart,
      value: vals.length > 0 ? Math.round(computeMedian(vals)) : 0,
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  return { median: Math.round(median), history };
}

function computeMedian(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Per-person pending review request counts from open PRs. */
export function computeReviewLoad(
  openPRs: { requested_reviewers: { login: string }[] }[],
): { login: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const pr of openPRs) {
    for (const r of pr.requested_reviewers) {
      counts.set(r.login, (counts.get(r.login) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([login, count]) => ({ login, count }))
    .sort((a, b) => b.count - a.count);
}

/** Per-person activity stats within a date range. */
export function computeContributorActivity(
  mergedPRs: { user: { login: string } | null; merged_at?: string | null }[],
  closedIssues: { closed_by?: string | null; closed_at?: string | null }[],
  tasks: { assignees: string[]; state: string; points?: number }[],
  sprintStart: string,
  sprintEnd: string,
): ContributorRow[] {
  const stats = new Map<string, ContributorRow>();
  const ensure = (login: string) => {
    if (!stats.has(login)) stats.set(login, { login, prsMerged: 0, issuesClosed: 0, pointsDone: 0 });
    return stats.get(login)!;
  };

  const start = new Date(sprintStart + "T00:00:00").getTime();
  const end = new Date(sprintEnd + "T23:59:59").getTime();

  for (const pr of mergedPRs) {
    if (!pr.user?.login || !pr.merged_at) continue;
    const t = new Date(pr.merged_at).getTime();
    if (t >= start && t <= end) ensure(pr.user.login).prsMerged++;
  }

  for (const issue of closedIssues) {
    if (!issue.closed_by || !issue.closed_at) continue;
    const t = new Date(issue.closed_at).getTime();
    if (t >= start && t <= end) ensure(issue.closed_by).issuesClosed++;
  }

  for (const task of tasks) {
    if (task.state !== "closed") continue;
    for (const a of task.assignees) {
      ensure(a).pointsDone += task.points ?? 0;
    }
  }

  return Array.from(stats.values()).sort((a, b) => b.pointsDone - a.pointsDone);
}

/** Compute attention-needed alerts for the overview dashboard. */
export function computeAlerts(
  openPRs: { created_at: string; requested_reviewers: { login: string }[]; draft: boolean }[],
  tasks: { state: string }[],
  sprint: SprintConfig | null,
  orgMemberCount: number,
): Alert[] {
  const alerts: Alert[] = [];
  const now = Date.now();

  // Stale PRs (>7 days old)
  const stalePRs = openPRs.filter(
    (pr) => !pr.draft && (now - new Date(pr.created_at).getTime()) / 86400000 > 7,
  ).length;
  if (stalePRs > 0) {
    alerts.push({ icon: "stale", label: "Stale PRs (>7d)", count: stalePRs, severity: stalePRs > 3 ? "red" : "amber" });
  }

  // Unreviewed PRs (no requested reviewers, not draft)
  const unreviewed = openPRs.filter((pr) => !pr.draft && pr.requested_reviewers.length === 0).length;
  if (unreviewed > 0) {
    alerts.push({ icon: "unreviewed", label: "Unreviewed PRs", count: unreviewed, severity: unreviewed > 3 ? "red" : "amber" });
  }

  // Review bottleneck (one person >40% of reviews)
  const reviewLoad = computeReviewLoad(openPRs);
  const totalReviews = reviewLoad.reduce((s, r) => s + r.count, 0);
  if (reviewLoad.length > 0 && totalReviews >= 3 && reviewLoad[0].count / totalReviews > 0.4) {
    alerts.push({
      icon: "bottleneck",
      label: "Review bottleneck",
      count: reviewLoad[0].count,
      severity: "amber",
      detail: reviewLoad[0].login,
    });
  }

  // Sprint at risk
  if (sprint) {
    const start = new Date(sprint.startDate + "T00:00:00").getTime();
    const end = new Date(sprint.endDate + "T23:59:59").getTime();
    const elapsed = Math.min(1, Math.max(0, (now - start) / (end - start)));
    const totalTasks = tasks.length;
    const doneTasks = tasks.filter((t) => t.state === "closed").length;
    const donePct = totalTasks > 0 ? doneTasks / totalTasks : 1;
    if (elapsed > 0.75 && donePct < 0.5 && totalTasks > 0) {
      alerts.push({
        icon: "sprint-risk",
        label: "Sprint at risk",
        count: totalTasks - doneTasks,
        severity: "red",
        detail: `${Math.round(donePct * 100)}% done, ${Math.round(elapsed * 100)}% time elapsed`,
      });
    }
  }

  // Large PR backlog
  const nonDraftPRs = openPRs.filter((pr) => !pr.draft).length;
  if (orgMemberCount > 0 && nonDraftPRs > 2 * orgMemberCount) {
    alerts.push({ icon: "backlog", label: "Large PR backlog", count: nonDraftPRs, severity: "amber" });
  }

  return alerts.slice(0, 5);
}

/** Sprint velocity trend from snapshots. */
export function computeVelocityTrend(
  snapshots: { sprintNumber: number; name: string; metrics: { donePoints: number } }[],
): { history: WeeklyBucket[]; average: number } {
  const sorted = [...snapshots].sort((a, b) => a.sprintNumber - b.sprintNumber).slice(-6);
  const history = sorted.map((s) => ({
    weekStart: `S${s.sprintNumber}`,
    value: s.metrics.donePoints,
  }));
  const avg = history.length > 0 ? Math.round(history.reduce((s, h) => s + h.value, 0) / history.length) : 0;
  return { history, average: avg };
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
