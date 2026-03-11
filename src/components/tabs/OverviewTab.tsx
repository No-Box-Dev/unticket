import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useMergedPRs, useAllIssues, useClosedIssues, useOrgMembers, useOpenPRs, useOpenIssues } from "@/hooks/useGitHub";
import { useFeatures, useSprint, useAllSprintSubIssues, useSprintSnapshots, usePeople } from "@/hooks/useConfigRepo";
import {
  computeMetric,
  computeMetricDaily,
  extractMergedDates,
  extractClosedDates,
  computeCycleTime,
  computeContributorActivity,
  computeAlerts,
  computeVelocityTrend,
  computeEngineerStatus,
} from "@/lib/metrics";
import { BarChart } from "@/components/BarChart";
import { CircularProgress } from "@/components/CircularProgress";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth";
import type { MetricData, Feature, SprintSnapshot, TabId } from "@/lib/types";
import {
  CheckCircle2,
  Circle,
  Rocket,
  Clock,
  AlertTriangle,
  Eye,
  Users,
  Zap,
  Layers,
  ChevronDown,
  ChevronRight,
  X,
  ExternalLink,
} from "lucide-react";

const RANGE_OPTIONS = [
  { label: "2w", weeks: 2 },
  { label: "1m", weeks: 4 },
  { label: "3m", weeks: 13 },
  { label: "6m", weeks: 26 },
  { label: "1y", weeks: 52 },
  { label: "All", weeks: 260 },
] as const;

const card = "bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-xl p-5";

interface OverviewTabProps {
  repoNames: string[];
  onTabChange?: (tab: TabId) => void;
}

/** Get the production timestamp for a feature, or null */
function getProductionDate(f: Feature): string | null {
  const entries = (f.statusHistory ?? []).filter((h) => h.status === "production");
  return entries.length > 0 ? entries[entries.length - 1].timestamp : null;
}

function formatCycleTime(hours: number): string {
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Health color: green >=80%, amber 50-80%, red <50% of expected pace */
function paceColor(done: number, total: number, elapsedPct: number): string {
  if (total === 0) return "#10b981";
  const expected = elapsedPct * total;
  const ratio = expected > 0 ? done / expected : 1;
  if (ratio >= 0.8) return "#10b981";
  if (ratio >= 0.5) return "#f59e0b";
  return "#ef4444";
}

const AGE_BUCKETS = [
  { label: ">4w", maxDays: Infinity, color: "#dc2626" },
  { label: "2-4w", maxDays: 28, color: "#ef4444" },
  { label: "1-2w", maxDays: 14, color: "#f97316" },
  { label: "3-7d", maxDays: 7, color: "#f59e0b" },
  { label: "1-3d", maxDays: 3, color: "#22c55e" },
  { label: "<1d", maxDays: 1, color: "#10b981" },
];

// Sorted ascending for matching: smallest bucket first
const AGE_BUCKETS_ASC = [...AGE_BUCKETS].sort((a, b) => a.maxDays - b.maxDays);

function computeAgeBuckets(items: { created_at: string }[]): { label: string; count: number; color: string }[] {
  const now = Date.now();
  const countMap = new Map(AGE_BUCKETS.map((b) => [b.label, 0]));
  for (const item of items) {
    const ageDays = (now - new Date(item.created_at).getTime()) / 86400000;
    for (const bucket of AGE_BUCKETS_ASC) {
      if (ageDays < bucket.maxDays || bucket.maxDays === Infinity) {
        countMap.set(bucket.label, (countMap.get(bucket.label) ?? 0) + 1);
        break;
      }
    }
  }
  return AGE_BUCKETS.map((b) => ({ label: b.label, count: countMap.get(b.label) ?? 0, color: b.color }));
}

function filterByAgeBucket(items: { created_at: string }[], bucketLabel: string): typeof items {
  const now = Date.now();
  const ascIdx = AGE_BUCKETS_ASC.findIndex((b) => b.label === bucketLabel);
  if (ascIdx < 0) return items;
  const minDays = ascIdx > 0 ? AGE_BUCKETS_ASC[ascIdx - 1].maxDays : 0;
  const maxDays = AGE_BUCKETS_ASC[ascIdx].maxDays;
  return items.filter((item) => {
    const ageDays = (now - new Date(item.created_at).getTime()) / 86400000;
    return ageDays >= minDays && (maxDays === Infinity ? true : ageDays < maxDays);
  });
}

function daysAgo(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

// ---------- Drawer types ----------
interface DrawerState {
  title: string;
  items: DrawerItem[];
}

interface DrawerItem {
  title: string;
  subtitle: string;
  url?: string;
  age?: string;
  createdAt?: string; // ISO date for sorting
}

export function OverviewTab({ repoNames, onTabChange }: OverviewTabProps) {
  const [weeks, setWeeks] = useState(13);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);

  const { user } = useAuth();
  const { data: mergedPRs, isLoading: mergedLoading } = useMergedPRs(repoNames);
  const { isLoading: issuesLoading } = useAllIssues(repoNames);
  const { data: closedIssues, isLoading: closedLoading } = useClosedIssues(repoNames);
  const { data: openPRs } = useOpenPRs(repoNames);
  const { data: openIssues } = useOpenIssues(repoNames);
  const { data: features } = useFeatures();
  const { data: sprint } = useSprint();
  const { data: orgMembers } = useOrgMembers();
  const { data: people } = usePeople();
  const { data: snapshots } = useSprintSnapshots();

  // Task data for current sprint
  const sprintFeatureIds = useMemo(() => {
    if (!features || !sprint) return [];
    return features.filter((f) => f.sprint === sprint.number).map((f) => f.id);
  }, [features, sprint]);
  const { data: allTasks } = useAllSprintSubIssues(sprintFeatureIds);

  const isLoading = mergedLoading || issuesLoading || closedLoading;
  const isDaily = weeks <= 2;
  const compute = (dates: string[]) =>
    isDaily ? computeMetricDaily(dates, weeks * 7) : computeMetric(dates, weeks);

  // Sprint timing
  const sprintTiming = useMemo(() => {
    if (!sprint) return null;
    const now = new Date();
    const start = new Date(sprint.startDate + "T00:00:00");
    const end = new Date(sprint.endDate + "T23:59:59");
    const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
    const elapsedDays = Math.max(0, Math.min(totalDays, Math.round((now.getTime() - start.getTime()) / 86400000)));
    const elapsedPct = Math.min(1, Math.max(0, elapsedDays / totalDays));
    return { totalDays, elapsedDays, elapsedPct };
  }, [sprint]);

  const taskStats = useMemo(() => {
    if (!allTasks) return { total: 0, closed: 0 };
    return { total: allTasks.length, closed: allTasks.filter((t) => t.state === "closed").length };
  }, [allTasks]);

  const sprintPoints = useMemo(() => {
    if (!allTasks) return { total: 0, done: 0 };
    const total = allTasks.reduce((sum, t) => sum + (t.points ?? 0), 0);
    const done = allTasks.filter((t) => t.state === "closed").reduce((sum, t) => sum + (t.points ?? 0), 0);
    return { total, done };
  }, [allTasks]);

  // At-risk features count
  const atRiskCount = useMemo(() => {
    if (!features || !sprint) return 0;
    const sprintFeatures = features.filter((f) => f.sprint === sprint.number);
    const ownerMap = new Map<string, Feature[]>();
    for (const f of sprintFeatures) {
      for (const o of f.owners) {
        if (!ownerMap.has(o)) ownerMap.set(o, []);
        ownerMap.get(o)!.push(f);
      }
    }
    let count = 0;
    for (const personFeatures of ownerMap.values()) {
      const status = computeEngineerStatus(personFeatures, sprint);
      if (status === "at-risk" || status === "behind") count++;
    }
    return count;
  }, [features, sprint]);

  // Metrics
  const metrics = useMemo(() => {
    if (!mergedPRs || !closedIssues) return null;
    const prsMerged = compute(extractMergedDates(mergedPRs as any));
    const issuesSolved = compute(extractClosedDates(closedIssues));
    const productionFeatures = (features ?? []).filter((f) => f.status === "production");
    const productionDates = productionFeatures.flatMap((f) =>
      (f.statusHistory ?? []).filter((h) => h.status === "production").map((h) => h.timestamp),
    );
    const featuresShipped: MetricData =
      productionDates.length > 0
        ? compute(productionDates)
        : { current: productionFeatures.length, previous: 0, change: 0, history: [] };
    return { prsMerged, issuesSolved, featuresShipped };
  }, [mergedPRs, closedIssues, features, weeks]);

  // Cycle time
  const cycleTime = useMemo(() => {
    if (!mergedPRs) return null;
    return computeCycleTime(mergedPRs as any, isDaily ? 2 : weeks);
  }, [mergedPRs, weeks, isDaily]);

  // Alerts
  const alerts = useMemo(() => {
    if (!openPRs) return [];
    return computeAlerts(openPRs as any[], allTasks ?? [], sprint ?? null, orgMembers?.length ?? 0);
  }, [openPRs, allTasks, sprint, orgMembers]);

  // Person name lookup
  const nameOf = (login: string) => people?.find((p) => p.github === login)?.name ?? login;

  // Age distribution for open PRs and open issues
  const prAgeBuckets = useMemo(() => computeAgeBuckets((openPRs as any[]) ?? []), [openPRs]);
  const issueAgeBuckets = useMemo(() => computeAgeBuckets((openIssues as any[]) ?? []), [openIssues]);

  // Contributor activity
  const contributorRange = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - weeks * 7);
    return { start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0] };
  }, [weeks]);

  const contributors = useMemo(() => {
    if (!mergedPRs || !closedIssues) return [];
    const all = computeContributorActivity(
      mergedPRs as any[], closedIssues as any[], allTasks ?? [],
      contributorRange.start, contributorRange.end,
    );

    const tasksByPerson = new Map<string, { done: number; total: number }>();
    for (const t of allTasks ?? []) {
      for (const a of t.assignees) {
        const entry = tasksByPerson.get(a) ?? { done: 0, total: 0 };
        entry.total++;
        if (t.state === "closed") entry.done++;
        tasksByPerson.set(a, entry);
      }
    }

    const rolesByPerson = new Map<string, { done: number; total: number }>();
    const roleGroups = new Map<number, { assignees: Set<string>; tasks: { state: string }[] }>();
    for (const t of allTasks ?? []) {
      if (!t.roleNumber) continue;
      const group = roleGroups.get(t.roleNumber) ?? { assignees: new Set(), tasks: [] };
      for (const a of t.assignees) group.assignees.add(a);
      group.tasks.push(t);
      roleGroups.set(t.roleNumber, group);
    }
    for (const group of roleGroups.values()) {
      const allClosed = group.tasks.every((t) => t.state === "closed");
      for (const login of group.assignees) {
        const entry = rolesByPerson.get(login) ?? { done: 0, total: 0 };
        entry.total++;
        if (allClosed) entry.done++;
        rolesByPerson.set(login, entry);
      }
    }

    const base = orgMembers && orgMembers.length > 0
      ? (() => {
          const activityMap = new Map(all.map((c) => [c.login, c]));
          return orgMembers.map((m: any) =>
            activityMap.get(m.login) ?? { login: m.login, prsMerged: 0, issuesClosed: 0, pointsDone: 0 },
          );
        })()
      : all;

    return base
      .map((c) => {
        const tasks = tasksByPerson.get(c.login) ?? { done: 0, total: 0 };
        const roles = rolesByPerson.get(c.login) ?? { done: 0, total: 0 };
        return { ...c, tasksDone: tasks.done, tasksTotal: tasks.total, rolesDone: roles.done, rolesTotal: roles.total };
      })
      .sort((a, b) => nameOf(a.login).localeCompare(nameOf(b.login)));
  }, [mergedPRs, closedIssues, allTasks, contributorRange, orgMembers, people]);

  // Velocity trend
  const velocity = useMemo(() => {
    if (!snapshots || snapshots.length < 2) return null;
    return computeVelocityTrend(snapshots);
  }, [snapshots]);

  // Features by sprint (collapsible)
  const cutoffDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - weeks * 7);
    return d.toISOString();
  }, [weeks]);

  const featuresBySprint = useMemo(() => {
    if (!features) return [];
    const groups = new Map<number, { sprintNumber: number; name: string; features: Feature[] }>();
    const currentSprintNum = sprint?.number ?? Infinity;
    for (const f of features) {
      if (f.sprint == null || f.status === "future") continue;
      // Exclude sprints after the current one
      if (f.sprint > currentSprintNum) continue;
      if (f.status === "production") {
        const prodDate = getProductionDate(f);
        if (prodDate && prodDate < cutoffDate) continue;
      }
      if (!groups.has(f.sprint)) {
        const snap = snapshots?.find((s: SprintSnapshot) => s.sprintNumber === f.sprint);
        groups.set(f.sprint, {
          sprintNumber: f.sprint,
          name: snap?.name ?? (sprint?.number === f.sprint ? sprint.name : `Sprint ${f.sprint}`),
          features: [],
        });
      }
      groups.get(f.sprint)!.features.push(f);
    }
    return Array.from(groups.values()).sort((a, b) => b.sprintNumber - a.sprintNumber);
  }, [features, sprint, snapshots, cutoffDate]);

  // ---------- Drawer openers ----------

  const openPRDrawer = (bucketLabel: string) => {
    const prs = filterByAgeBucket((openPRs as any[]) ?? [], bucketLabel);
    setDrawer({
      title: `Open PRs — ${bucketLabel}`,
      items: prs.map((pr: any) => ({
        title: pr.title,
        subtitle: pr.head?.repo?.name ?? pr.repo ?? "",
        url: pr.html_url,
        age: daysAgo(pr.created_at),
        createdAt: pr.created_at,
      })),
    });
  };

  const openIssueDrawer = (bucketLabel: string) => {
    const issues = filterByAgeBucket((openIssues as any[]) ?? [], bucketLabel);
    setDrawer({
      title: `Open Issues — ${bucketLabel}`,
      items: issues.map((i: any) => ({
        title: i.title,
        subtitle: i.repo ?? "",
        url: i.html_url,
        age: daysAgo(i.created_at),
        createdAt: i.created_at,
      })),
    });
  };

  const openAlertDrawer = (alert: { icon: string; label: string }) => {
    const now = Date.now();
    let items: DrawerItem[] = [];

    if (alert.icon === "stale" && openPRs) {
      items = (openPRs as any[])
        .filter((pr: any) => !pr.draft && (now - new Date(pr.created_at).getTime()) / 86400000 > 7)
        .map((pr: any) => ({ title: pr.title, subtitle: pr.head?.repo?.name ?? pr.repo ?? "", url: pr.html_url, age: daysAgo(pr.created_at), createdAt: pr.created_at }));
    } else if (alert.icon === "unreviewed" && openPRs) {
      items = (openPRs as any[])
        .filter((pr: any) => !pr.draft && pr.requested_reviewers.length === 0)
        .map((pr: any) => ({ title: pr.title, subtitle: pr.head?.repo?.name ?? pr.repo ?? "", url: pr.html_url, age: daysAgo(pr.created_at), createdAt: pr.created_at }));
    } else if (alert.icon === "bottleneck" && openPRs) {
      // Show all PRs pending review for the bottleneck person
      const counts = new Map<string, number>();
      for (const pr of (openPRs as any[])) {
        for (const r of pr.requested_reviewers) counts.set(r.login, (counts.get(r.login) ?? 0) + 1);
      }
      const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
      const topReviewer = sorted[0]?.[0];
      if (topReviewer) {
        items = (openPRs as any[])
          .filter((pr: any) => pr.requested_reviewers.some((r: any) => r.login === topReviewer))
          .map((pr: any) => ({ title: pr.title, subtitle: pr.head?.repo?.name ?? pr.repo ?? "", url: pr.html_url, age: daysAgo(pr.created_at), createdAt: pr.created_at }));
      }
    } else if (alert.icon === "sprint-risk" && allTasks) {
      items = allTasks
        .filter((t) => t.state === "open")
        .map((t) => ({ title: t.title, subtitle: t.featureTitle || `Feature #${t.featureId}`, url: t.html_url }));
    } else if (alert.icon === "backlog" && openPRs) {
      items = (openPRs as any[])
        .filter((pr: any) => !pr.draft)
        .map((pr: any) => ({ title: pr.title, subtitle: pr.head?.repo?.name ?? pr.repo ?? "", url: pr.html_url, age: daysAgo(pr.created_at), createdAt: pr.created_at }));
    }

    setDrawer({ title: alert.label, items });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Spinner className="w-6 h-6 text-brand" /></div>;
  }

  const taskPct = taskStats.total > 0 ? Math.round((taskStats.closed / taskStats.total) * 100) : 0;
  const pointsPct = sprintPoints.total > 0 ? Math.round((sprintPoints.done / sprintPoints.total) * 100) : 0;
  const elapsedPct = sprintTiming?.elapsedPct ?? 0;
  const nav = (tab: TabId) => onTabChange?.(tab);

  return (
    <div className="space-y-6">
      {/* Detail Drawer */}
      {drawer && <DetailDrawer drawer={drawer} onClose={() => setDrawer(null)} />}

      {/* Section 1: Sprint Health Banner */}
      {sprint && sprintTiming && (
        <div className={card + " !p-0"}>
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-stone-200 dark:divide-white/[0.06]">
            {/* Sprint timer — click → sprint tab */}
            <button onClick={() => nav("sprint")} className="p-5 text-left hover:bg-stone-50 dark:hover:bg-white/[0.04] transition-colors rounded-l-xl cursor-pointer">
              <span className="text-[10px] font-semibold text-stone-400 dark:text-neutral-500 uppercase tracking-wider block mb-1">Sprint</span>
              <span className="text-sm font-semibold text-stone-800 dark:text-neutral-200 block">{sprint.name}</span>
              <span className="text-xs text-stone-500 dark:text-neutral-400 block mt-0.5">
                Day {sprintTiming.elapsedDays} of {sprintTiming.totalDays}
              </span>
              <div className="h-1.5 bg-stone-100 dark:bg-dark-overlay rounded-full overflow-hidden mt-2">
                <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${Math.round(elapsedPct * 100)}%` }} />
              </div>
            </button>

            {/* Task completion — click → sprint tab */}
            <button onClick={() => nav("sprint")} className="p-5 flex items-center gap-3 hover:bg-stone-50 dark:hover:bg-white/[0.04] transition-colors cursor-pointer">
              <div className="relative">
                <CircularProgress value={taskPct} color={paceColor(taskStats.closed, taskStats.total, elapsedPct)} />
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-stone-600 dark:text-neutral-300">{taskPct}%</span>
              </div>
              <div>
                <span className="text-[10px] font-semibold text-stone-400 dark:text-neutral-500 uppercase tracking-wider block">Tasks</span>
                <span className="text-sm font-semibold text-stone-800 dark:text-neutral-200">{taskStats.closed}/{taskStats.total}</span>
              </div>
            </button>

            {/* Points progress — click → sprint tab */}
            <button onClick={() => nav("sprint")} className="p-5 flex items-center gap-3 hover:bg-stone-50 dark:hover:bg-white/[0.04] transition-colors cursor-pointer">
              <div className="relative">
                <CircularProgress value={pointsPct} color={paceColor(sprintPoints.done, sprintPoints.total, elapsedPct)} />
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-stone-600 dark:text-neutral-300">{pointsPct}%</span>
              </div>
              <div>
                <span className="text-[10px] font-semibold text-stone-400 dark:text-neutral-500 uppercase tracking-wider block">Points</span>
                <span className="text-sm font-semibold text-stone-800 dark:text-neutral-200">{sprintPoints.done}/{sprintPoints.total}</span>
              </div>
            </button>

            {/* At-risk — click → sprint tab */}
            <button onClick={() => nav("sprint")} className="p-5 text-left hover:bg-stone-50 dark:hover:bg-white/[0.04] transition-colors rounded-r-xl cursor-pointer">
              <span className="text-[10px] font-semibold text-stone-400 dark:text-neutral-500 uppercase tracking-wider block mb-1">At Risk</span>
              {atRiskCount === 0 ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <CheckCircle2 size={14} className="text-green-500" />
                  <span className="text-sm font-medium text-green-600 dark:text-green-400">All on track</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 mt-1">
                  <AlertTriangle size={14} className="text-amber-500" />
                  <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">{atRiskCount} at risk</span>
                </div>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Section 2: Key Metrics + Range selector */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold text-stone-800 dark:text-neutral-200 font-display">Key Metrics</h2>
        <div className="flex items-center gap-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              onClick={() => setWeeks(opt.weeks)}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-full cursor-pointer transition-colors",
                weeks === opt.weeks
                  ? "bg-brand text-white"
                  : "bg-stone-100 dark:bg-dark-overlay text-stone-600 dark:text-neutral-400 hover:bg-stone-200 dark:hover:bg-white/[0.1]",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {metrics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="PR Throughput" metric={metrics.prsMerged} color="#3b82f6" daily={isDaily} onClick={() => nav("prs")} />
          {cycleTime && (
            <button onClick={() => nav("prs")} className={card + " text-left cursor-pointer hover:border-stone-300 dark:hover:border-white/[0.12] transition-colors"}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-stone-500 dark:text-neutral-400 uppercase tracking-wider">PR Cycle Time</span>
                <span className="text-2xl font-bold font-display" style={{ color: "#8b5cf6" }}>{formatCycleTime(cycleTime.median)}</span>
              </div>
              {cycleTime.history.length > 0 && <BarChart data={cycleTime.history} color="#8b5cf6" daily={isDaily} />}
            </button>
          )}
          <MetricCard title="Issues Resolved" metric={metrics.issuesSolved} color="#10b981" daily={isDaily} onClick={() => nav("issues")} />
          <MetricCard title="Features Shipped" metric={metrics.featuresShipped} color="#1B6971" daily={isDaily} onClick={() => nav("sprint")} />
        </div>
      )}

      {/* Section 3: Attention Needed */}
      <div className={card}>
        <h3 className="text-xs font-semibold text-stone-500 dark:text-neutral-400 uppercase tracking-wider mb-3">Attention Needed</h3>
        {alerts.length === 0 ? (
          <div className="flex items-center gap-2 py-2">
            <CheckCircle2 size={16} className="text-green-500" />
            <span className="text-sm text-green-600 dark:text-green-400 font-medium">No issues detected</span>
          </div>
        ) : (
          <div className="space-y-1">
            {alerts.map((alert, i) => (
              <button
                key={i}
                onClick={() => openAlertDrawer(alert)}
                className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-lg w-full text-left hover:bg-stone-50 dark:hover:bg-white/[0.04] transition-colors cursor-pointer"
              >
                <AlertIcon type={alert.icon} severity={alert.severity} />
                <span className="text-sm text-stone-700 dark:text-neutral-300 flex-1">{alert.label}</span>
                {alert.detail && (
                  <span className="text-xs text-stone-400 dark:text-neutral-500">{alert.detail}</span>
                )}
                <span
                  className={cn(
                    "text-xs font-semibold px-2 py-0.5 rounded-full",
                    alert.severity === "red"
                      ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                  )}
                >
                  {alert.count}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Section 4: Age distribution charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AgeBucketChart title="Open PRs by Age" buckets={prAgeBuckets} total={(openPRs as any[])?.length ?? 0} onBarClick={openPRDrawer} onTitleClick={() => nav("prs")} />
        <AgeBucketChart title="Open Issues by Age" buckets={issueAgeBuckets} total={(openIssues as any[])?.length ?? 0} onBarClick={openIssueDrawer} onTitleClick={() => nav("issues")} />
      </div>

      {/* Contributor Activity */}
      <div className={card}>
        <h3 className="text-xs font-semibold text-stone-500 dark:text-neutral-400 uppercase tracking-wider mb-3">
          Contributor Activity ({RANGE_OPTIONS.find((o) => o.weeks === weeks)?.label ?? `${weeks}w`})
        </h3>
        {contributors.length === 0 ? (
          <span className="text-sm text-stone-400 dark:text-neutral-500">No activity this sprint</span>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] text-stone-400 dark:text-neutral-500 uppercase tracking-wider">
                  <th className="text-left pb-2 font-semibold">Person</th>
                  <th className="text-right pb-2 font-semibold">PRs</th>
                  <th className="text-right pb-2 font-semibold">Issues</th>
                  <th className="text-right pb-2 font-semibold">Roles</th>
                  <th className="text-right pb-2 font-semibold">Tasks</th>
                  <th className="text-right pb-2 font-semibold">Points</th>
                </tr>
              </thead>
              <tbody>
                {contributors.map((c) => {
                  const isMe = c.login === user?.login;
                  return (
                    <tr
                      key={c.login}
                      onClick={() => nav("engineers")}
                      className={cn(
                        "border-t border-stone-100 dark:border-white/[0.04] cursor-pointer hover:bg-stone-50 dark:hover:bg-white/[0.04] transition-colors",
                        isMe && "border-l-2 border-l-brand",
                      )}
                    >
                      <td className={cn("py-1.5 text-stone-700 dark:text-neutral-300", isMe && "pl-2 font-medium")}>{nameOf(c.login)}</td>
                      <td className="py-1.5 text-right text-stone-600 dark:text-neutral-400">{c.prsMerged}</td>
                      <td className="py-1.5 text-right text-stone-600 dark:text-neutral-400">{c.issuesClosed}</td>
                      <td className="py-1.5 text-right text-stone-600 dark:text-neutral-400">{c.rolesTotal > 0 ? `${c.rolesDone}/${c.rolesTotal}` : "—"}</td>
                      <td className="py-1.5 text-right text-stone-600 dark:text-neutral-400">{c.tasksTotal > 0 ? `${c.tasksDone}/${c.tasksTotal}` : "—"}</td>
                      <td className="py-1.5 text-right font-semibold text-stone-700 dark:text-neutral-200">{c.pointsDone}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section 5: Velocity & Features */}
      {velocity && velocity.history.length >= 2 && (
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-stone-500 dark:text-neutral-400 uppercase tracking-wider">Sprint Velocity</h3>
            <span className="text-xs text-stone-400 dark:text-neutral-500">avg {velocity.average} pts</span>
          </div>
          <BarChart data={velocity.history} color="#1B6971" />
        </div>
      )}

      {/* Features by Sprint — click feature → sprint tab */}
      {featuresBySprint.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-stone-800 dark:text-neutral-200 font-display">Features Developed</h2>
          {featuresBySprint.map((group) => (
            <SprintFeatureGroup
              key={group.sprintNumber}
              group={group}
              isCurrent={sprint?.number === group.sprintNumber}
              onFeatureClick={() => nav("sprint")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Detail Drawer ----------

function DetailDrawer({ drawer, onClose }: { drawer: DrawerState; onClose: () => void }) {
  // Group items by repo (subtitle)
  const grouped = useMemo(() => {
    const map = new Map<string, DrawerItem[]>();
    for (const item of drawer.items) {
      const repo = item.subtitle || "Other";
      if (!map.has(repo)) map.set(repo, []);
      map.get(repo)!.push(item);
    }
    // Sort items within each group oldest first
    for (const items of map.values()) {
      items.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [drawer.items]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />
      {/* Panel */}
      <div
        className="relative w-full max-w-md bg-white dark:bg-dark-raised shadow-xl flex flex-col animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200 dark:border-white/[0.06]">
          <h2 className="font-semibold text-stone-900 dark:text-neutral-100 text-sm">{drawer.title}</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-stone-400 dark:text-neutral-500">{drawer.items.length} items</span>
            <button onClick={onClose} className="p-1 rounded hover:bg-stone-100 dark:hover:bg-white/[0.08] transition-colors cursor-pointer">
              <X size={16} className="text-stone-500 dark:text-neutral-400" />
            </button>
          </div>
        </div>
        {/* Items grouped by repo */}
        <div className="flex-1 overflow-y-auto">
          {drawer.items.length === 0 ? (
            <div className="p-5 text-sm text-stone-400 dark:text-neutral-500 text-center">No items</div>
          ) : (
            <div>
              {grouped.map(([repo, items]) => (
                <div key={repo}>
                  {/* Repo header */}
                  <div className="sticky top-0 px-5 py-2 bg-stone-50 dark:bg-dark-overlay border-b border-stone-200 dark:border-white/[0.06] flex items-center justify-between">
                    <span className="text-xs font-semibold text-stone-600 dark:text-neutral-300">{repo}</span>
                    <span className="text-[10px] text-stone-400 dark:text-neutral-500">{items.length}</span>
                  </div>
                  {/* Items */}
                  <div className="divide-y divide-stone-100 dark:divide-white/[0.04]">
                    {items.map((item, i) => (
                      <div key={i} className="px-5 py-2.5 hover:bg-stone-50 dark:hover:bg-white/[0.04] transition-colors">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            {item.url ? (
                              <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-sm text-stone-800 dark:text-neutral-200 hover:text-brand transition-colors flex items-center gap-1">
                                <span className="truncate">{item.title}</span>
                                <ExternalLink size={11} className="shrink-0 opacity-40" />
                              </a>
                            ) : (
                              <span className="text-sm text-stone-800 dark:text-neutral-200 block truncate">{item.title}</span>
                            )}
                          </div>
                          {item.age && <span className="text-[10px] text-stone-400 dark:text-neutral-500 shrink-0">{item.age}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------- Sub-components ----------

function SprintFeatureGroup({
  group,
  isCurrent,
  onFeatureClick,
}: {
  group: { sprintNumber: number; name: string; features: Feature[] };
  isCurrent: boolean;
  onFeatureClick: () => void;
}) {
  const [expanded, setExpanded] = useState(isCurrent);
  const done = group.features.filter((f) => f.status === "production").length;

  return (
    <div className={card}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left cursor-pointer"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown size={14} className="text-stone-400" /> : <ChevronRight size={14} className="text-stone-400" />}
          <h3 className="font-semibold text-stone-900 dark:text-neutral-100">{group.name}</h3>
          {isCurrent && (
            <span className="text-[10px] font-semibold bg-brand/10 text-brand px-1.5 py-0.5 rounded">Current</span>
          )}
        </div>
        <span className="text-xs text-stone-400 dark:text-neutral-500">{done}/{group.features.length} shipped</span>
      </button>
      {expanded && (
        <div className="space-y-1.5 mt-3">
          {group.features
            .sort((a, b) => statusOrder(a.status) - statusOrder(b.status))
            .map((f) => (
              <button
                key={f.id}
                onClick={onFeatureClick}
                className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-stone-50 dark:hover:bg-white/[0.06] transition-colors w-full text-left cursor-pointer"
              >
                <StatusIcon status={f.status} />
                <span className="text-sm text-stone-700 dark:text-neutral-300 flex-1 truncate">{f.title}</span>
                {f.owners.length > 0 && (
                  <span className="text-xs text-stone-400 dark:text-neutral-500 shrink-0">{f.owners.join(", ")}</span>
                )}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function AgeBucketChart({
  title,
  buckets,
  total,
  onBarClick,
  onTitleClick,
}: {
  title: string;
  buckets: { label: string; count: number; color: string }[];
  total: number;
  onBarClick?: (label: string) => void;
  onTitleClick?: () => void;
}) {
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const barHeight = 100; // px
  return (
    <div className={card}>
      <div className="flex items-center justify-between mb-4">
        <button onClick={onTitleClick} className="text-xs font-semibold text-stone-500 dark:text-neutral-400 uppercase tracking-wider hover:text-brand transition-colors cursor-pointer">
          {title}
        </button>
        <button onClick={onTitleClick} className="text-2xl font-bold font-display text-stone-700 dark:text-neutral-200 hover:text-brand transition-colors cursor-pointer">
          {total}
        </button>
      </div>
      <div className="flex items-end gap-2" style={{ height: barHeight + 20 }}>
        {buckets.map((b) => {
          const h = b.count === 0 ? 0 : Math.max(4, Math.round((b.count / max) * barHeight));
          return (
            <button
              key={b.label}
              onClick={() => b.count > 0 && onBarClick?.(b.label)}
              className={cn("flex-1 flex flex-col items-center justify-end", b.count > 0 && "cursor-pointer group")}
              style={{ height: barHeight + 20 }}
            >
              {b.count > 0 && (
                <span className="text-[10px] font-semibold text-stone-600 dark:text-neutral-300 group-hover:text-brand transition-colors mb-1">{b.count}</span>
              )}
              <div
                className="w-full rounded-t transition-all duration-500 group-hover:opacity-80"
                style={{ height: h, backgroundColor: b.color }}
              />
            </button>
          );
        })}
      </div>
      <div className="flex gap-2 mt-1">
        {buckets.map((b) => (
          <div key={b.label} className="flex-1 text-center">
            <span className="text-[10px] text-stone-400 dark:text-neutral-500">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AlertIcon({ type, severity }: { type: string; severity: "amber" | "red" }) {
  const cls = severity === "red" ? "text-red-500" : "text-amber-500";
  switch (type) {
    case "stale": return <Clock size={14} className={cls} />;
    case "unreviewed": return <Eye size={14} className={cls} />;
    case "bottleneck": return <Users size={14} className={cls} />;
    case "sprint-risk": return <Zap size={14} className={cls} />;
    case "backlog": return <Layers size={14} className={cls} />;
    default: return <AlertTriangle size={14} className={cls} />;
  }
}

const STATUS_ORDER: Record<string, number> = { production: 0, demo: 1, plan: 2, future: 3 };
function statusOrder(status: string) { return STATUS_ORDER[status] ?? 4; }

function StatusIcon({ status }: { status: string }) {
  if (status === "production") return <CheckCircle2 size={14} className="text-green-500 shrink-0" />;
  if (status === "demo") return <Rocket size={14} className="text-blue-500 shrink-0" />;
  if (status === "plan") return <Clock size={14} className="text-amber-500 shrink-0" />;
  return <Circle size={14} className="text-stone-300 dark:text-neutral-600 shrink-0" />;
}

function MetricCard({ title, metric, color, daily, onClick }: { title: string; metric: MetricData; color: string; daily?: boolean; onClick?: () => void }) {
  const total = metric.history.length > 0
    ? metric.history.reduce((sum, b) => sum + b.value, 0)
    : metric.current;

  return (
    <button onClick={onClick} className={card + " text-left cursor-pointer hover:border-stone-300 dark:hover:border-white/[0.12] transition-colors"}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-stone-500 dark:text-neutral-400 uppercase tracking-wider">{title}</span>
        <span className="text-2xl font-bold font-display" style={{ color }}>{total}</span>
      </div>
      {metric.history.length > 0 && (
        <BarChart data={metric.history} color={color} daily={daily} />
      )}
    </button>
  );
}
