import { useState, useMemo } from "react";
import { useOpenPRs, useOpenIssues, useMergedPRs, useClosedIssues, useAllIssues } from "@/hooks/useGitHub";
import { useFeatures, useSettings } from "@/hooks/useConfigRepo";
import { MetricCard } from "@/components/MetricCard";
import {
  computeMetric,
  computeCumulativeMetric,
  extractMergedDates,
  extractClosedDates,
  extractCreatedDates,
  buildOpenIssueSnapshots,
} from "@/lib/metrics";
import { RefreshCw, Users, Flag } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import type { MetricData } from "@/lib/types";

interface TeamTabProps {
  repoNames: string[];
}

const METRIC_WEEKS = 10;

export function TeamTab({ repoNames }: TeamTabProps) {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const [selectedTeam, setSelectedTeam] = useState<string>("all");

  const teams = useMemo(
    () => settings?.teams ?? [],
    [settings],
  );

  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - METRIC_WEEKS * 7);
    return d.toISOString();
  }, []);

  const { data: openPRs, isLoading: prsLoading } = useOpenPRs(repoNames);
  const { data: openIssues, isLoading: issuesLoading } = useOpenIssues(repoNames);
  const { data: mergedPRs } = useMergedPRs(repoNames, since);
  const { data: closedIssues } = useClosedIssues(repoNames, since);
  const { data: allIssues } = useAllIssues(repoNames, since);
  const { data: features } = useFeatures();

  const isLoading = prsLoading || issuesLoading;

  // Filter data by selected team's repos
  const filterByTeam = (items: any[], repoField: string = "repo") => {
    if (selectedTeam === "all") return items;
    const team = teams.find((t) => t.name === selectedTeam);
    if (!team) return items;
    const teamRepos = new Set(team.repos ?? []);
    return items.filter((i) => {
      const repo = repoField === "head" ? i.head?.repo?.name : i[repoField];
      return teamRepos.has(repo);
    });
  };

  // Features filtered by team
  const teamFeatures = useMemo(() => {
    if (selectedTeam === "all") return features ?? [];
    return (features ?? []).filter((f) => f.team === selectedTeam);
  }, [features, selectedTeam]);

  // Priority breakdown
  const priorityBreakdown = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0, none: 0 };
    for (const f of teamFeatures.filter((f) => f.status !== "done")) {
      const p = f.priority ?? "none";
      counts[p]++;
    }
    return counts;
  }, [teamFeatures]);

  const metrics: { title: string; metric: MetricData; color: string; invertTrend?: boolean }[] = useMemo(() => {
    const teamAllIssues = filterByTeam(allIssues ?? []);
    const teamClosedIssues = filterByTeam(closedIssues ?? []);
    const teamMergedPRs = filterByTeam(mergedPRs ?? [], "head");
    const teamOpenPRs = filterByTeam(openPRs ?? [], "head");
    const teamOpenIssues = filterByTeam(openIssues ?? []);

    // Issues Remaining — use openIssues (all currently open, not limited by since)
    // with allIssues history for the trend line
    const issueSnapshots = buildOpenIssueSnapshots(teamAllIssues as any, METRIC_WEEKS);
    const issuesRemainingTrend = computeCumulativeMetric(issueSnapshots);
    const issuesRemaining: MetricData = {
      ...issuesRemainingTrend,
      current: teamOpenIssues.length,
    };

    // Issues Solved
    const solvedDates = extractClosedDates(teamClosedIssues);
    const issuesSolved = computeMetric(solvedDates, METRIC_WEEKS);

    // Features Complete
    const doneFeatures = teamFeatures.filter((f) => f.status === "done");
    const featuresComplete: MetricData = {
      current: doneFeatures.length,
      previous: 0,
      change: 0,
      history: [],
    };

    // PRs Merged
    const mergedDates = extractMergedDates(teamMergedPRs as any);
    const prsMerged = computeMetric(mergedDates, METRIC_WEEKS);

    // Issues Identified (created)
    const createdDates = extractCreatedDates(teamAllIssues as any);
    const issuesIdentified = computeMetric(createdDates, METRIC_WEEKS);

    // PRs Open (current snapshot)
    const prsOpen: MetricData = {
      current: teamOpenPRs.length,
      previous: 0,
      change: 0,
      history: [],
    };

    return [
      { title: "Issues Remaining", metric: issuesRemaining, color: "#ef4444", invertTrend: true },
      { title: "Issues Solved", metric: issuesSolved, color: "#10b981" },
      { title: "Features Complete", metric: featuresComplete, color: "#1B6971" },
      { title: "PRs Merged", metric: prsMerged, color: "#3b82f6" },
      { title: "Issues Identified", metric: issuesIdentified, color: "#d97706" },
      { title: "PRs Open", metric: prsOpen, color: "#8b5cf6" },
    ];
  }, [openPRs, openIssues, mergedPRs, closedIssues, allIssues, teamFeatures, selectedTeam, teams]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["prs"] });
    qc.invalidateQueries({ queryKey: ["issues"] });
    qc.invalidateQueries({ queryKey: ["mergedPRs"] });
    qc.invalidateQueries({ queryKey: ["closedIssues"] });
    qc.invalidateQueries({ queryKey: ["allIssues"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-stone-400" />
          <h2 className="text-lg font-semibold text-stone-800">Team Metrics</h2>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-brand cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Team filter */}
      {teams.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-stone-400 uppercase tracking-wider">Team</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSelectedTeam("all")}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-full cursor-pointer transition-colors",
                selectedTeam === "all"
                  ? "bg-brand text-white"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200",
              )}
            >
              All
            </button>
            {teams.map((team) => (
              <button
                key={team.name}
                onClick={() => setSelectedTeam(team.name === selectedTeam ? "all" : team.name)}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-full cursor-pointer transition-colors",
                  selectedTeam === team.name
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

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-stone-400">
          Computing metrics...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {metrics.map((m) => (
              <MetricCard
                key={m.title}
                title={m.title}
                metric={m.metric}
                color={m.color}
                invertTrend={m.invertTrend}
              />
            ))}
          </div>

          {/* Feature priority breakdown */}
          {teamFeatures.length > 0 && (
            <div className="bg-white rounded-xl border border-stone-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Flag className="w-4 h-4 text-stone-400" />
                <h3 className="text-sm font-semibold text-stone-700">Feature Priority</h3>
                <span className="text-xs text-stone-400">
                  {teamFeatures.filter((f) => f.status !== "done").length} active/future
                </span>
              </div>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-1.5">
                  <Flag className="w-3.5 h-3.5 text-red-500" fill="currentColor" />
                  <span className="text-sm text-stone-700 font-medium">{priorityBreakdown.high}</span>
                  <span className="text-xs text-stone-400">High</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Flag className="w-3.5 h-3.5 text-orange-400" fill="currentColor" />
                  <span className="text-sm text-stone-700 font-medium">{priorityBreakdown.medium}</span>
                  <span className="text-xs text-stone-400">Medium</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Flag className="w-3.5 h-3.5 text-green-500" fill="currentColor" />
                  <span className="text-sm text-stone-700 font-medium">{priorityBreakdown.low}</span>
                  <span className="text-xs text-stone-400">Low</span>
                </div>
                {priorityBreakdown.none > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Flag className="w-3.5 h-3.5 text-stone-300" />
                    <span className="text-sm text-stone-700 font-medium">{priorityBreakdown.none}</span>
                    <span className="text-xs text-stone-400">Unset</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
