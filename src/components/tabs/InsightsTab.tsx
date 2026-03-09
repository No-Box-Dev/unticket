import { useState, useMemo, useCallback } from "react";
import { usePeople, useFeatures, useSettings } from "@/hooks/useConfigRepo";
import {
  useAllPRs,
  useMergedPRs,
  useClosedIssues,
  useAllIssues,
  useOrgMembers,
} from "@/hooks/useGitHub";
import { useAuth } from "@/lib/auth";
import { BarChart } from "@/components/BarChart";
import { computeMetric, computeMetricDaily, extractMergedDates, extractClosedDates, extractCreatedDates } from "@/lib/metrics";
import type { MetricData } from "@/lib/types";
import { cn } from "@/lib/cn";
import { BarChart3, X, ExternalLink } from "lucide-react";
import { Spinner } from "@/components/Spinner";

interface InsightsTabProps {
  repoNames: string[];
}

type MetricKey = "prsMerged" | "issuesCreated" | "issuesSolved" | "featuresImplemented";

interface SidebarState {
  metricKey: MetricKey;
  weekStart: string;
  title: string;
  color: string;
}

const RANGE_OPTIONS = [
  { label: "1w", weeks: 1 },
  { label: "2w", weeks: 2 },
  { label: "1m", weeks: 4 },
  { label: "10w", weeks: 10 },
  { label: "6m", weeks: 26 },
  { label: "1y", weeks: 52 },
] as const;

const METRIC_TITLES: Record<MetricKey, string> = {
  prsMerged: "PRs Merged",
  issuesCreated: "Issues Created",
  issuesSolved: "Issues Solved",
  featuresImplemented: "Features Implemented",
};

function isInBucket(dateStr: string, bucketStart: string, daily: boolean): boolean {
  const date = new Date(dateStr);
  const bs = new Date(bucketStart + "T00:00:00");
  const be = new Date(bs);
  be.setDate(be.getDate() + (daily ? 1 : 7));
  return date >= bs && date < be;
}

interface SidebarItem {
  title: string;
  subtitle: string;
  author?: string;
  url?: string;
}

function groupByRepo(items: SidebarItem[]): [string, SidebarItem[]][] {
  const groups = new Map<string, SidebarItem[]>();
  for (const item of items) {
    const key = item.subtitle || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
}

function formatBucketRange(bucketStart: string, daily: boolean): string {
  const start = new Date(bucketStart + "T00:00:00");
  if (daily) {
    return start.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function InsightsTab({ repoNames }: InsightsTabProps) {
  const { user } = useAuth();
  const { data: settings } = useSettings();
  const { data: people } = usePeople();
  const { data: orgMembers } = useOrgMembers();
  const { data: features } = useFeatures();

  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [weeks, setWeeks] = useState(10);
  const [sidebar, setSidebar] = useState<SidebarState | null>(null);

  const teams = useMemo(() => settings?.teams ?? [], [settings]);

  // Data hooks
  const { data: allPRs, isLoading: prsLoading } = useAllPRs(repoNames);
  const { data: mergedPRs, isLoading: mergedLoading } = useMergedPRs(repoNames);
  const { data: closedIssues, isLoading: closedLoading } = useClosedIssues(repoNames);
  const { data: allIssues, isLoading: allLoading } = useAllIssues(repoNames);

  const isLoading = prsLoading || mergedLoading || closedLoading || allLoading;

  // Person list
  const personList = useMemo(() => {
    const raw =
      people && people.length > 0
        ? people
        : (orgMembers ?? []).map((m: any) => ({
            github: m.login,
            name: m.login,
            teams: [] as string[],
            role: "",
          }));
    const myLogin = user?.login?.toLowerCase();
    return [...raw].sort((a, b) => {
      if (a.github.toLowerCase() === myLogin) return -1;
      if (b.github.toLowerCase() === myLogin) return 1;
      return (a.name || a.github).localeCompare(b.name || b.github);
    });
  }, [people, orgMembers, user]);

  const filteredPersonList = useMemo(() => {
    if (teamFilter === "all") return personList;
    return personList.filter((p) => p.teams.includes(teamFilter));
  }, [personList, teamFilter]);

  // null means "All" (team view), a string means individual
  const activePerson = selectedPerson;
  const activePersonLower = activePerson?.toLowerCase();
  const isAllView = activePerson === null;

  // Team filtering helper
  const filterByTeam = useCallback((items: any[], repoField: string = "repo") => {
    if (teamFilter === "all") return items;
    const team = teams.find((t) => t.name === teamFilter);
    if (!team) return items;
    const teamRepos = new Set(team.repos ?? []);
    return items.filter((i) => {
      const repo = repoField === "head" ? i.head?.repo?.name : i[repoField];
      return teamRepos.has(repo);
    });
  }, [teamFilter, teams]);

  // --- Team (All) view: filtered raw data ---
  const teamRawData = useMemo(() => {
    if (!isAllView) return null;
    return {
      mergedPRs: filterByTeam(mergedPRs ?? [], "head"),
      allIssues: filterByTeam(allIssues ?? []),
      closedIssues: filterByTeam(closedIssues ?? []),
      features: teamFilter === "all"
        ? (features ?? [])
        : (features ?? []).filter((f) => f.team === teamFilter),
    };
  }, [isAllView, mergedPRs, allIssues, closedIssues, features, teamFilter, filterByTeam]);

  const isDaily = weeks <= 2;
  const compute = (dates: string[]) =>
    isDaily ? computeMetricDaily(dates, weeks * 7) : computeMetric(dates, weeks);

  const teamMetrics = useMemo(() => {
    if (!teamRawData) return null;

    const prsMerged = compute(extractMergedDates(teamRawData.mergedPRs as any));
    const issuesCreated = compute(extractCreatedDates(teamRawData.allIssues as any));
    const issuesSolved = compute(extractClosedDates(teamRawData.closedIssues));

    const productionFeatures = teamRawData.features.filter((f) => f.status === "production");
    const productionDates = productionFeatures
      .flatMap((f) =>
        (f.statusHistory ?? [])
          .filter((h) => h.status === "production")
          .map((h) => h.timestamp),
      );
    const featuresImplemented: MetricData =
      productionDates.length > 0
        ? compute(productionDates)
        : { current: productionFeatures.length, previous: 0, change: 0, history: [] };

    return { prsMerged, issuesCreated, issuesSolved, featuresImplemented };
  }, [teamRawData, weeks]);

  // --- Individual view: filtered raw data ---
  const individualRawData = useMemo(() => {
    if (isAllView || !activePersonLower) return null;
    return {
      mergedPRs: (allPRs ?? []).filter(
        (pr: any) => pr.user?.login?.toLowerCase() === activePersonLower && pr.merged_at,
      ),
      createdIssues: (allIssues ?? []).filter(
        (i: any) => i.user?.login?.toLowerCase() === activePersonLower,
      ),
      closedIssues: (closedIssues ?? []).filter((i: any) =>
        i.closed_by?.toLowerCase() === activePersonLower,
      ),
      features: (features ?? []).filter(
        (f) => f.status === "production" && f.owners.some((o) => o.toLowerCase() === activePersonLower),
      ),
    };
  }, [isAllView, activePersonLower, allPRs, allIssues, closedIssues, features]);

  const individualMetrics = useMemo(() => {
    if (!individualRawData) return null;

    const prsMerged = compute(extractMergedDates(individualRawData.mergedPRs as any));
    const issuesCreated = compute(extractCreatedDates(individualRawData.createdIssues as any));
    const issuesSolved = compute(extractClosedDates(individualRawData.closedIssues));

    const productionDates = individualRawData.features
      .flatMap((f) =>
        (f.statusHistory ?? [])
          .filter((h) => h.status === "production")
          .map((h) => h.timestamp),
      );
    const featuresImplemented: MetricData =
      productionDates.length > 0
        ? compute(productionDates)
        : { current: individualRawData.features.length, previous: 0, change: 0, history: [] };

    return { prsMerged, issuesCreated, issuesSolved, featuresImplemented };
  }, [individualRawData, weeks]);

  const metrics = isAllView ? teamMetrics : individualMetrics;
  const rawData = isAllView ? teamRawData : individualRawData;

  // Sidebar items for selected week
  const sidebarItems = useMemo(() => {
    if (!sidebar || !rawData) return [];

    const { metricKey, weekStart } = sidebar;

    if (metricKey === "prsMerged") {
      const prs = "mergedPRs" in rawData ? rawData.mergedPRs : [];
      return (prs as any[])
        .filter((pr: any) => pr.merged_at && isInBucket(pr.merged_at, weekStart, isDaily))
        .map((pr: any) => ({
          title: pr.title,
          subtitle: pr.head?.repo?.name ?? "",
          author: pr.user?.login,
          url: pr.html_url,
        }));
    }

    if (metricKey === "issuesCreated") {
      const issues = "allIssues" in rawData ? (rawData as any).allIssues : "createdIssues" in rawData ? (rawData as any).createdIssues : [];
      return (issues as any[])
        .filter((i: any) => isInBucket(i.created_at, weekStart, isDaily))
        .map((i: any) => ({
          title: i.title,
          subtitle: i.repo ?? "",
          author: i.user?.login,
          url: i.html_url,
        }));
    }

    if (metricKey === "issuesSolved") {
      return (rawData.closedIssues as any[])
        .filter((i: any) => i.closed_at && isInBucket(i.closed_at, weekStart, isDaily))
        .map((i: any) => ({
          title: i.title,
          subtitle: i.repo ?? "",
          author: (i.assignees ?? []).map((a: any) => a.login).join(", "),
          url: i.html_url,
        }));
    }

    if (metricKey === "featuresImplemented") {
      return (rawData.features as any[])
        .filter((f) =>
          (f.statusHistory ?? []).some(
            (h: any) => h.status === "production" && isInBucket(h.timestamp, weekStart, isDaily),
          ),
        )
        .map((f) => ({
          title: f.title,
          subtitle: f.team ?? "",
          author: f.owners?.join(", "),
          url: f.url,
        }));
    }

    return [];
  }, [sidebar, rawData, isDaily]);

  const handleBarClick = useCallback(
    (metricKey: MetricKey, color: string) => (weekStart: string) => {
      setSidebar((prev) =>
        prev?.metricKey === metricKey && prev?.weekStart === weekStart
          ? null
          : { metricKey, weekStart, title: METRIC_TITLES[metricKey], color },
      );
    },
    [],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-5 h-5 text-stone-400" />
          <h2 className="text-lg font-semibold text-stone-800 font-display">Insights</h2>
        </div>
        <div className="flex items-center gap-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              onClick={() => { setWeeks(opt.weeks); setSidebar(null); }}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-full cursor-pointer transition-colors",
                weeks === opt.weeks
                  ? "bg-brand text-white"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Team filter */}
      {teams.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-stone-400 uppercase tracking-wider">Team</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setTeamFilter("all");
                setSelectedPerson(null);
                setSidebar(null);
              }}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-full cursor-pointer transition-colors",
                teamFilter === "all"
                  ? "bg-brand text-white"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200",
              )}
            >
              All
            </button>
            {teams.map((team) => (
              <button
                key={team.name}
                onClick={() => {
                  const next = team.name === teamFilter ? "all" : team.name;
                  setTeamFilter(next);
                  setSelectedPerson(null);
                  setSidebar(null);
                }}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-full cursor-pointer transition-colors",
                  teamFilter === team.name
                    ? "bg-brand text-white"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200",
                )}
              >
                {team.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Person selector: All + individual people */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => { setSelectedPerson(null); setSidebar(null); }}
          className={cn(
            "px-3 py-1.5 text-sm font-medium rounded-full transition-colors cursor-pointer",
            isAllView
              ? "bg-brand text-white"
              : "bg-white border border-stone-200 text-stone-600 hover:border-brand hover:text-brand",
          )}
        >
          All
        </button>
        {filteredPersonList.map((person) => (
          <button
            key={person.github}
            onClick={() => { setSelectedPerson(person.github); setSidebar(null); }}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-full transition-colors cursor-pointer",
              activePerson === person.github
                ? "bg-brand text-white"
                : "bg-white border border-stone-200 text-stone-600 hover:border-brand hover:text-brand",
            )}
          >
            {person.name || person.github}
          </button>
        ))}
      </div>

      {/* Metric cards */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : metrics ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <InsightCard
            title="PRs Merged"
            metric={metrics.prsMerged}
            color="#3b82f6"
            onBarClick={handleBarClick("prsMerged", "#3b82f6")}
            activeWeek={sidebar?.metricKey === "prsMerged" ? sidebar.weekStart : null}
            daily={isDaily}
          />
          <InsightCard
            title="Issues Created"
            metric={metrics.issuesCreated}
            color="#d97706"
            onBarClick={handleBarClick("issuesCreated", "#d97706")}
            activeWeek={sidebar?.metricKey === "issuesCreated" ? sidebar.weekStart : null}
            daily={isDaily}
          />
          <InsightCard
            title="Issues Solved"
            metric={metrics.issuesSolved}
            color="#10b981"
            onBarClick={handleBarClick("issuesSolved", "#10b981")}
            activeWeek={sidebar?.metricKey === "issuesSolved" ? sidebar.weekStart : null}
            daily={isDaily}
          />
          <InsightCard
            title="Features Implemented"
            metric={metrics.featuresImplemented}
            color="#1B6971"
            onBarClick={handleBarClick("featuresImplemented", "#1B6971")}
            activeWeek={sidebar?.metricKey === "featuresImplemented" ? sidebar.weekStart : null}
            daily={isDaily}
          />
        </div>
      ) : null}

      {/* Full-height overlay sidebar */}
      {sidebar && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setSidebar(null)} />
          <div className="fixed top-0 right-0 z-50 h-full w-80 bg-white border-l border-stone-200 shadow-xl flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-stone-100">
              <div>
                <h3 className="text-sm font-semibold text-stone-800">{sidebar.title}</h3>
                <p className="text-xs text-stone-400 mt-0.5">{formatBucketRange(sidebar.weekStart, isDaily)}</p>
              </div>
              <button
                onClick={() => setSidebar(null)}
                className="p-1 rounded-md hover:bg-stone-100 text-stone-400 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {sidebarItems.length === 0 ? (
                <p className="text-sm text-stone-400 py-8 text-center">No items this week.</p>
              ) : (
                <div className="space-y-4">
                  {groupByRepo(sidebarItems).map(([repo, items]) => (
                    <div key={repo}>
                      <h4 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1.5">
                        {repo || "Other"}
                      </h4>
                      <div className="space-y-1.5">
                        {items.map((item, i) => (
                          <a
                            key={i}
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block p-2.5 rounded-lg border border-stone-100 hover:border-stone-200 hover:bg-stone-50 transition-colors group"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-sm font-medium text-stone-700 leading-snug line-clamp-2">
                                {item.title}
                              </span>
                              <ExternalLink className="w-3 h-3 text-stone-300 group-hover:text-stone-400 shrink-0 mt-0.5" />
                            </div>
                            {item.author && (
                              <span className="text-xs text-stone-400 mt-1 block">{item.author}</span>
                            )}
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function InsightCard({
  title,
  metric,
  color,
  onBarClick,
  activeWeek,
  daily,
}: {
  title: string;
  metric: MetricData;
  color: string;
  onBarClick?: (weekStart: string) => void;
  activeWeek?: string | null;
  daily?: boolean;
}) {
  const total = metric.history.length > 0
    ? metric.history.reduce((sum, b) => sum + b.value, 0)
    : metric.current;
  const hasChart = metric.history.length > 0;

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4">
      <div className="text-xs font-medium text-stone-500 uppercase tracking-wider mb-2">
        {title}
      </div>
      <div className="mb-3">
        <span className="text-3xl font-semibold text-stone-800" style={{ color }}>
          {total}
        </span>
      </div>
      {hasChart && (
        <BarChart
          data={metric.history}
          color={color}
          onBarClick={onBarClick}
          activeWeek={activeWeek}
          daily={daily}
        />
      )}
    </div>
  );
}
