import { useState, useMemo } from "react";
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
import { computeMetric, extractMergedDates, extractClosedDates, extractCreatedDates } from "@/lib/metrics";
import type { MetricData } from "@/lib/types";
import { cn } from "@/lib/cn";
import { TrendingUp, TrendingDown, Minus, BarChart3 } from "lucide-react";

interface InsightsTabProps {
  repoNames: string[];
}

type View = "team" | "individual";

const RANGE_OPTIONS = [
  { label: "1m", weeks: 4 },
  { label: "10w", weeks: 10 },
  { label: "6m", weeks: 26 },
  { label: "1y", weeks: 52 },
] as const;

export function InsightsTab({ repoNames }: InsightsTabProps) {
  const { user } = useAuth();
  const { data: settings } = useSettings();
  const { data: people } = usePeople();
  const { data: orgMembers } = useOrgMembers();
  const { data: features } = useFeatures();

  const [view, setView] = useState<View>("team");
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [weeks, setWeeks] = useState(10);

  const teams = useMemo(() => settings?.teams ?? [], [settings]);

  // Data hooks
  const { data: allPRs, isLoading: prsLoading } = useAllPRs(repoNames);
  const { data: mergedPRs, isLoading: mergedLoading } = useMergedPRs(repoNames);
  const { data: closedIssues, isLoading: closedLoading } = useClosedIssues(repoNames);
  const { data: allIssues, isLoading: allLoading } = useAllIssues(repoNames);

  const isLoading = prsLoading || mergedLoading || closedLoading || allLoading;

  // Person list (same pattern as IndividualTab)
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

  // Filter people by team
  const filteredPersonList = useMemo(() => {
    if (teamFilter === "all") return personList;
    return personList.filter((p) => p.teams.includes(teamFilter));
  }, [personList, teamFilter]);

  // Default selected person: current user or first in list
  const activePerson =
    selectedPerson ??
    (user && filteredPersonList.some((p) => p.github.toLowerCase() === user.login.toLowerCase())
      ? user.login
      : null) ??
    (filteredPersonList.length > 0 ? filteredPersonList[0].github : null);

  const activePersonLower = activePerson?.toLowerCase();

  // Team filtering helper
  const filterByTeam = (items: any[], repoField: string = "repo") => {
    if (teamFilter === "all") return items;
    const team = teams.find((t) => t.name === teamFilter);
    if (!team) return items;
    const teamRepos = new Set(team.repos ?? []);
    return items.filter((i) => {
      const repo = repoField === "head" ? i.head?.repo?.name : i[repoField];
      return teamRepos.has(repo);
    });
  };

  // --- Team view metrics ---
  const teamMetrics = useMemo(() => {
    if (view !== "team") return null;

    const filteredMergedPRs = filterByTeam(mergedPRs ?? [], "head");
    const filteredAllIssues = filterByTeam(allIssues ?? []);
    const filteredClosedIssues = filterByTeam(closedIssues ?? []);

    const prsMerged = computeMetric(extractMergedDates(filteredMergedPRs as any), weeks);
    const issuesCreated = computeMetric(extractCreatedDates(filteredAllIssues as any), weeks);
    const issuesSolved = computeMetric(extractClosedDates(filteredClosedIssues), weeks);

    // Features implemented
    const teamFeatures =
      teamFilter === "all"
        ? (features ?? [])
        : (features ?? []).filter((f) => f.team === teamFilter);
    const productionFeatures = teamFeatures.filter((f) => f.status === "production");

    // Try to build bar chart from statusHistory timestamps
    const productionDates = productionFeatures
      .flatMap((f) =>
        (f.statusHistory ?? [])
          .filter((h) => h.status === "production")
          .map((h) => h.timestamp),
      );
    const featuresImplemented: MetricData =
      productionDates.length > 0
        ? computeMetric(productionDates, weeks)
        : { current: productionFeatures.length, previous: 0, change: 0, history: [] };

    return { prsMerged, issuesCreated, issuesSolved, featuresImplemented };
  }, [view, mergedPRs, allIssues, closedIssues, features, teamFilter, teams, weeks]);

  // --- Individual view metrics ---
  const individualMetrics = useMemo(() => {
    if (view !== "individual" || !activePersonLower) return null;

    // PRs Merged: user authored + has merged_at
    const personMergedPRs = (allPRs ?? []).filter(
      (pr: any) => pr.user?.login?.toLowerCase() === activePersonLower && pr.merged_at,
    );
    const prsMerged = computeMetric(extractMergedDates(personMergedPRs as any), weeks);

    // Issues Created
    const personCreatedIssues = (allIssues ?? []).filter(
      (i: any) => i.user?.login?.toLowerCase() === activePersonLower,
    );
    const issuesCreated = computeMetric(extractCreatedDates(personCreatedIssues as any), weeks);

    // Issues Solved: closed issues where person is assignee
    const personClosedIssues = (closedIssues ?? []).filter((i: any) =>
      (i.assignees ?? []).some((a: any) => a.login?.toLowerCase() === activePersonLower),
    );
    const issuesSolved = computeMetric(extractClosedDates(personClosedIssues), weeks);

    // Features implemented by this person
    const personFeatures = (features ?? []).filter(
      (f) => f.status === "production" && f.owners.some((o) => o.toLowerCase() === activePersonLower),
    );
    const productionDates = personFeatures
      .flatMap((f) =>
        (f.statusHistory ?? [])
          .filter((h) => h.status === "production")
          .map((h) => h.timestamp),
      );
    const featuresImplemented: MetricData =
      productionDates.length > 0
        ? computeMetric(productionDates, weeks)
        : { current: personFeatures.length, previous: 0, change: 0, history: [] };

    return { prsMerged, issuesCreated, issuesSolved, featuresImplemented };
  }, [view, activePersonLower, allPRs, allIssues, closedIssues, features, weeks]);

  const metrics = view === "team" ? teamMetrics : individualMetrics;

  return (
    <div className="space-y-6">
      {/* Header: title + view toggle + date range */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-5 h-5 text-stone-400" />
          <h2 className="text-lg font-semibold text-stone-800">Insights</h2>
          <div className="flex items-center bg-stone-100 rounded-full p-0.5">
            <button
              onClick={() => setView("team")}
              aria-pressed={view === "team"}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-full cursor-pointer transition-colors",
                view === "team" ? "bg-white text-stone-800 shadow-sm" : "text-stone-500",
              )}
            >
              Team
            </button>
            <button
              onClick={() => setView("individual")}
              aria-pressed={view === "individual"}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-full cursor-pointer transition-colors",
                view === "individual" ? "bg-white text-stone-800 shadow-sm" : "text-stone-500",
              )}
            >
              Individual
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              onClick={() => setWeeks(opt.weeks)}
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

      {/* Person selector (individual view only) */}
      {view === "individual" && (
        <div className="flex flex-wrap gap-2">
          {filteredPersonList.map((person) => (
            <button
              key={person.github}
              onClick={() => setSelectedPerson(person.github)}
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
          {filteredPersonList.length === 0 && (
            <p className="text-sm text-stone-400">No team members found.</p>
          )}
        </div>
      )}

      {/* Metric cards */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-stone-400">
          Loading metrics...
        </div>
      ) : metrics ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <InsightCard title="PRs Merged" metric={metrics.prsMerged} color="#3b82f6" />
          <InsightCard title="Issues Created" metric={metrics.issuesCreated} color="#d97706" />
          <InsightCard title="Issues Solved" metric={metrics.issuesSolved} color="#10b981" />
          <InsightCard title="Features Implemented" metric={metrics.featuresImplemented} color="#1B6971" />
        </div>
      ) : null}
    </div>
  );
}

function InsightCard({ title, metric, color }: { title: string; metric: MetricData; color: string }) {
  const total = metric.history.length > 0
    ? metric.history.reduce((sum, b) => sum + b.value, 0)
    : metric.current;
  const isPositive = metric.change > 0;
  const isNeutral = metric.change === 0;
  const hasChart = metric.history.length > 0;

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4">
      <div className="text-xs font-medium text-stone-500 uppercase tracking-wider mb-2">
        {title}
      </div>
      <div className="flex items-end justify-between mb-3">
        <span className="text-3xl font-semibold text-stone-800" style={{ color }}>
          {total}
        </span>
        {hasChart && !isNeutral ? (
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
        ) : hasChart ? (
          <span className="flex items-center gap-0.5 text-xs text-stone-400">
            <Minus className="w-3 h-3" />
            No change
          </span>
        ) : null}
      </div>
      {hasChart && <BarChart data={metric.history} color={color} />}
    </div>
  );
}
