import { useMemo } from "react";
import { useOpenPRs, useOpenIssues, useMergedPRs, useClosedIssues, useAllIssues } from "@/hooks/useGitHub";
import { useFeatures } from "@/hooks/useConfigRepo";
import { MetricCard } from "@/components/MetricCard";
import {
  computeMetric,
  computeCumulativeMetric,
  extractMergedDates,
  extractClosedDates,
  extractCreatedDates,
  buildOpenIssueSnapshots,
} from "@/lib/metrics";
import { RefreshCw, Users } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { MetricData } from "@/lib/types";

interface TeamTabProps {
  repoNames: string[];
}

const METRIC_WEEKS = 10;

export function TeamTab({ repoNames }: TeamTabProps) {
  const qc = useQueryClient();
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

  const metrics: { title: string; metric: MetricData; color: string; invertTrend?: boolean }[] = useMemo(() => {
    // Issues Remaining (cumulative snapshot)
    const issueSnapshots = buildOpenIssueSnapshots(
      (allIssues ?? []) as any,
      METRIC_WEEKS,
    );
    const issuesRemaining = computeCumulativeMetric(issueSnapshots);

    // Issues Solved
    const solvedDates = extractClosedDates(closedIssues ?? []);
    const issuesSolved = computeMetric(solvedDates, METRIC_WEEKS);

    // Features Complete
    const doneFeatures = (features ?? []).filter((f) => f.status === "done");
    const featuresComplete: MetricData = {
      current: doneFeatures.length,
      previous: 0,
      change: 0,
      history: [],
    };

    // PRs Merged
    const mergedDates = extractMergedDates((mergedPRs ?? []) as any);
    const prsMerged = computeMetric(mergedDates, METRIC_WEEKS);

    // Issues Identified (created)
    const createdDates = extractCreatedDates((allIssues ?? []) as any);
    const issuesIdentified = computeMetric(createdDates, METRIC_WEEKS);

    // PRs Open (current snapshot)
    const prsOpen: MetricData = {
      current: (openPRs ?? []).length,
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
  }, [openPRs, openIssues, mergedPRs, closedIssues, allIssues, features]);

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

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-stone-400">
          Computing metrics...
        </div>
      ) : (
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
      )}
    </div>
  );
}
