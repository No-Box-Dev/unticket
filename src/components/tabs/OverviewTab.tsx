import { useState, useMemo } from "react";
import { useMergedPRs, useAllIssues, useClosedIssues, useOrgMembers } from "@/hooks/useGitHub";
import { useFeatures, useSprint, useAllSprintSubIssues, useSprintSnapshots } from "@/hooks/useConfigRepo";
import { computeMetric, computeMetricDaily, extractMergedDates, extractClosedDates, extractCreatedDates, buildOpenIssueSnapshots, computeCumulativeMetric } from "@/lib/metrics";
import { BarChart } from "@/components/BarChart";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import type { MetricData, Feature } from "@/lib/types";
import { CheckCircle2, Circle, Rocket, Clock } from "lucide-react";

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
}

/** Get the production timestamp for a feature, or null */
function getProductionDate(f: Feature): string | null {
  const entries = (f.statusHistory ?? []).filter((h) => h.status === "production");
  return entries.length > 0 ? entries[entries.length - 1].timestamp : null;
}

export function OverviewTab({ repoNames }: OverviewTabProps) {
  const [weeks, setWeeks] = useState(13);

  const { data: mergedPRs, isLoading: mergedLoading } = useMergedPRs(repoNames);
  const { data: allIssues, isLoading: issuesLoading } = useAllIssues(repoNames);
  const { data: closedIssues, isLoading: closedLoading } = useClosedIssues(repoNames);
  const { data: features } = useFeatures();
  const { data: sprint } = useSprint();
  const { data: orgMembers } = useOrgMembers();
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

  const cutoffDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - weeks * 7);
    return d.toISOString();
  }, [weeks]);

  const metrics = useMemo(() => {
    if (!mergedPRs || !allIssues || !closedIssues) return null;

    const prsMerged = compute(extractMergedDates(mergedPRs as any));
    const issuesCreated = compute(extractCreatedDates(allIssues as any));
    const issuesSolved = compute(extractClosedDates(closedIssues));

    const productionFeatures = (features ?? []).filter((f) => f.status === "production");
    const productionDates = productionFeatures
      .flatMap((f) =>
        (f.statusHistory ?? [])
          .filter((h) => h.status === "production")
          .map((h) => h.timestamp),
      );
    const featuresShipped: MetricData =
      productionDates.length > 0
        ? compute(productionDates)
        : { current: productionFeatures.length, previous: 0, change: 0, history: [] };

    const openIssues = computeCumulativeMetric(buildOpenIssueSnapshots(allIssues as any, weeks));

    return { prsMerged, issuesCreated, issuesSolved, featuresShipped, openIssues };
  }, [mergedPRs, allIssues, closedIssues, features, weeks]);

  // Summary stats
  const sprintFeatures = useMemo(() => {
    if (!features || !sprint) return [];
    return features.filter((f) => f.sprint === sprint.number);
  }, [features, sprint]);

  const taskStats = useMemo(() => {
    if (!allTasks) return { total: 0, open: 0, closed: 0 };
    const total = allTasks.length;
    const closed = allTasks.filter((t) => t.state === "closed").length;
    return { total, open: total - closed, closed };
  }, [allTasks]);

  const sprintPoints = useMemo(() => {
    if (!allTasks) return { total: 0, done: 0 };
    const total = allTasks.reduce((sum, t) => sum + (t.points ?? 0), 0);
    const done = allTasks
      .filter((t) => t.state === "closed")
      .reduce((sum, t) => sum + (t.points ?? 0), 0);
    return { total, done };
  }, [allTasks]);

  const summaryStats = useMemo(() => ({
    repos: repoNames.length,
    members: orgMembers?.length ?? 0,
    totalFeatures: features?.length ?? 0,
    sprintFeatures: sprintFeatures.length,
    sprintComplete: sprintFeatures.filter((f) => f.status === "production").length,
    openIssues: (allIssues as any[])?.filter((i: any) => i.state === "open")?.length ?? 0,
  }), [repoNames, orgMembers, features, sprintFeatures, allIssues]);

  // Features grouped by sprint — only features deployed within selected time range
  const featuresBySprint = useMemo(() => {
    if (!features) return [];
    const groups = new Map<number, { sprintNumber: number; name: string; features: Feature[] }>();

    for (const f of features) {
      if (f.sprint == null || f.status === "future") continue;
      // Only include features that reached production within the time range
      if (f.status === "production") {
        const prodDate = getProductionDate(f);
        if (prodDate && prodDate < cutoffDate) continue;
      }
      if (!groups.has(f.sprint)) {
        const snap = snapshots?.find((s) => s.sprintNumber === f.sprint);
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

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Spinner className="w-6 h-6 text-brand" /></div>;
  }

  const taskPct = taskStats.total > 0 ? Math.round((taskStats.closed / taskStats.total) * 100) : 0;
  const pointsPct = sprintPoints.total > 0 ? Math.round((sprintPoints.done / sprintPoints.total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header + Range selector */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold text-stone-800 dark:text-neutral-200 font-display">Overview</h2>
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

      {/* Quick summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MiniStat label="Repos" value={summaryStats.repos} />
        <MiniStat label="Team" value={summaryStats.members} />
        <MiniStat label="Open Issues" value={summaryStats.openIssues} color={summaryStats.openIssues > 0 ? "text-amber-500" : undefined} />
        <MiniStat label="Features" value={summaryStats.totalFeatures} />
        <MiniStat label="Sprint Features" value={summaryStats.sprintFeatures} />
        <MiniStat label="Sprint Done" value={summaryStats.sprintComplete} color="text-green-500" />
      </div>

      {/* Sprint progress: Tasks + Points */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-stone-500 dark:text-neutral-400 uppercase tracking-wider">Sprint Tasks</span>
            <span className="text-sm font-semibold text-stone-700 dark:text-neutral-200">{taskStats.closed}/{taskStats.total}</span>
          </div>
          <div className="h-3 bg-stone-100 dark:bg-dark-overlay rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${taskPct}%` }} />
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-stone-400 dark:text-neutral-500">{taskStats.open} open</span>
            <span className="text-xs font-medium text-blue-500">{taskPct}%</span>
          </div>
        </div>

        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-stone-500 dark:text-neutral-400 uppercase tracking-wider">Sprint Points</span>
            <span className="text-sm font-semibold text-stone-700 dark:text-neutral-200">{sprintPoints.done}/{sprintPoints.total}</span>
          </div>
          <div className="h-3 bg-stone-100 dark:bg-dark-overlay rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-purple-500 transition-all duration-500" style={{ width: `${pointsPct}%` }} />
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-stone-400 dark:text-neutral-500">{sprintPoints.total - sprintPoints.done} remaining</span>
            <span className="text-xs font-medium text-purple-500">{pointsPct}%</span>
          </div>
        </div>
      </div>

      {/* Main metric cards */}
      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MetricCard title="PRs Merged" metric={metrics.prsMerged} color="#3b82f6" daily={isDaily} />
          <MetricCard title="Issues Created" metric={metrics.issuesCreated} color="#d97706" daily={isDaily} />
          <MetricCard title="Issues Solved" metric={metrics.issuesSolved} color="#10b981" daily={isDaily} />
          <MetricCard title="Features Shipped" metric={metrics.featuresShipped} color="#1B6971" daily={isDaily} />
        </div>
      )}

      {/* Open issues trend */}
      {metrics && metrics.openIssues.history.length > 0 && (
        <div className={card}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-stone-900 dark:text-neutral-100">Open Issues Trend</h3>
            <span className="text-2xl font-bold text-amber-500 font-display">{summaryStats.openIssues}</span>
          </div>
          <BarChart data={metrics.openIssues.history} color="#f59e0b" daily={isDaily} />
        </div>
      )}

      {/* Features by Sprint */}
      {featuresBySprint.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-stone-800 dark:text-neutral-200 font-display">Features Developed</h2>
          {featuresBySprint.map((group) => {
            const done = group.features.filter((f) => f.status === "production").length;
            const isCurrent = sprint?.number === group.sprintNumber;
            return (
              <div key={group.sprintNumber} className={card}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-stone-900 dark:text-neutral-100">{group.name}</h3>
                    {isCurrent && (
                      <span className="text-[10px] font-semibold bg-brand/10 text-brand px-1.5 py-0.5 rounded">Current</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-stone-400 dark:text-neutral-500">
                    <span>{done}/{group.features.length} shipped</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {group.features
                    .sort((a, b) => statusOrder(a.status) - statusOrder(b.status))
                    .map((f) => (
                      <div key={f.id} className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-stone-50 dark:hover:bg-white/[0.06] transition-colors">
                        <StatusIcon status={f.status} />
                        <span className="text-sm text-stone-700 dark:text-neutral-300 flex-1 truncate">{f.title}</span>
                        {f.owners.length > 0 && (
                          <span className="text-xs text-stone-400 dark:text-neutral-500 shrink-0">{f.owners.join(", ")}</span>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className={card + " py-3 px-4"}>
      <span className="text-[10px] font-semibold text-stone-400 dark:text-neutral-500 uppercase tracking-wider block">{label}</span>
      <span className={cn("text-2xl font-bold font-display", color ?? "text-stone-700 dark:text-neutral-200")}>{value}</span>
    </div>
  );
}

const STATUS_ORDER: Record<string, number> = { production: 0, demo: 1, plan: 2, future: 3 };
function statusOrder(status: string) { return STATUS_ORDER[status] ?? 4; }

function StatusIcon({ status }: { status: string }) {
  if (status === "production") return <CheckCircle2 size={14} className="text-green-500 shrink-0" />;
  if (status === "demo") return <Rocket size={14} className="text-blue-500 shrink-0" />;
  if (status === "plan") return <Clock size={14} className="text-amber-500 shrink-0" />;
  return <Circle size={14} className="text-stone-300 dark:text-neutral-600 shrink-0" />;
}

function MetricCard({ title, metric, color, daily }: { title: string; metric: MetricData; color: string; daily?: boolean }) {
  const total = metric.history.length > 0
    ? metric.history.reduce((sum, b) => sum + b.value, 0)
    : metric.current;

  return (
    <div className={card}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-stone-500 dark:text-neutral-400 uppercase tracking-wider">{title}</span>
        <span className="text-2xl font-bold font-display" style={{ color }}>{total}</span>
      </div>
      {metric.history.length > 0 && (
        <BarChart data={metric.history} color={color} daily={daily} />
      )}
    </div>
  );
}
