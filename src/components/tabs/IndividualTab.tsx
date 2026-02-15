import { useState, useMemo } from "react";
import { usePeople, useSettings } from "@/hooks/useConfigRepo";
import { useMergedPRs, useClosedIssues, useAllIssues, useOrgMembers } from "@/hooks/useGitHub";
import { MetricCard } from "@/components/MetricCard";
import { Sparkline } from "@/components/Sparkline";
import { computeMetric, extractMergedDates, extractClosedDates, extractCreatedDates } from "@/lib/metrics";
import { cn } from "@/lib/cn";
import { User } from "lucide-react";

interface IndividualTabProps {
  repoNames: string[];
}

const METRIC_WEEKS = 10;

export function IndividualTab({ repoNames }: IndividualTabProps) {
  const { data: people } = usePeople();
  const { data: settings } = useSettings();
  const { data: orgMembers } = useOrgMembers();
  const [selected, setSelected] = useState<string | null>(null);
  const [teamFilter, setTeamFilter] = useState<string>("all");

  const teams = useMemo(
    () => settings?.teams ?? [],
    [settings],
  );

  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - METRIC_WEEKS * 7);
    return d.toISOString();
  }, []);

  const { data: mergedPRs } = useMergedPRs(repoNames, since);
  const { data: closedIssues } = useClosedIssues(repoNames, since);
  const { data: allIssues } = useAllIssues(repoNames, since);

  // Use people from config, or fall back to org members
  const personList = useMemo(() => {
    if (people && people.length > 0) return people;
    return (orgMembers ?? []).map((m: any) => ({
      github: m.login,
      name: m.login,
      teams: [] as string[],
      role: "",
    }));
  }, [people, orgMembers]);

  // Filter people by team
  const filteredPersonList = useMemo(() => {
    if (teamFilter === "all") return personList;
    return personList.filter((p) => p.teams.includes(teamFilter));
  }, [personList, teamFilter]);

  const selectedPerson = selected ?? (filteredPersonList.length > 0 ? filteredPersonList[0].github : null);
  const personInfo = personList.find((p) => p.github === selectedPerson);
  const personTeams = personInfo ? teams.filter((t) => personInfo.teams.includes(t.name)) : [];

  // Filter data for selected person
  const personMergedPRs = useMemo(
    () => (mergedPRs ?? []).filter((pr: any) => pr.user?.login === selectedPerson),
    [mergedPRs, selectedPerson],
  );

  const personClosedIssues = useMemo(
    () =>
      (closedIssues ?? []).filter((i: any) =>
        (i.assignees ?? []).some((a: any) => a.login === selectedPerson),
      ),
    [closedIssues, selectedPerson],
  );

  const personCreatedIssues = useMemo(
    () =>
      (allIssues ?? []).filter((i: any) => i.user?.login === selectedPerson),
    [allIssues, selectedPerson],
  );

  // Metrics
  const prsMergedMetric = useMemo(
    () => computeMetric(extractMergedDates(personMergedPRs as any), METRIC_WEEKS),
    [personMergedPRs],
  );

  const issuesSolvedMetric = useMemo(
    () => computeMetric(extractClosedDates(personClosedIssues), METRIC_WEEKS),
    [personClosedIssues],
  );

  const issuesIdentifiedMetric = useMemo(
    () => computeMetric(extractCreatedDates(personCreatedIssues), METRIC_WEEKS),
    [personCreatedIssues],
  );

  // Combined activity for sparkline
  const allActivityDates = useMemo(() => {
    const merged = extractMergedDates(personMergedPRs as any);
    const closed = extractClosedDates(personClosedIssues);
    return [...merged, ...closed].sort();
  }, [personMergedPRs, personClosedIssues]);

  const activityMetric = useMemo(
    () => computeMetric(allActivityDates, METRIC_WEEKS),
    [allActivityDates],
  );

  // Recent activity items
  const recentActivity = useMemo(() => {
    const items: { type: string; text: string; date: string }[] = [];
    for (const pr of personMergedPRs.slice(0, 5)) {
      items.push({
        type: "pr",
        text: `Merged PR #${pr.number} in ${(pr as any).repo}`,
        date: (pr as any).merged_at ?? pr.updated_at,
      });
    }
    for (const issue of personClosedIssues.slice(0, 5)) {
      items.push({
        type: "issue",
        text: `Closed Issue #${issue.number}`,
        date: issue.updated_at,
      });
    }
    return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 6);
  }, [personMergedPRs, personClosedIssues]);

  if (personList.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-stone-500">No team members found.</p>
        <p className="text-sm text-stone-400 mt-1">
          Add a <code>people.json</code> to your <code>.gitpulse</code> repo.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Team filter + Person picker */}
      {teams.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-stone-400 uppercase tracking-wider">Team</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setTeamFilter("all"); setSelected(null); }}
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
                  setSelected(null);
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

      <div className="flex flex-wrap gap-2">
        {filteredPersonList.map((person) => (
          <button
            key={person.github}
            onClick={() => setSelected(person.github)}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-full transition-colors cursor-pointer",
              selectedPerson === person.github
                ? "bg-brand text-white"
                : "bg-white border border-stone-200 text-stone-600 hover:border-brand hover:text-brand",
            )}
          >
            {person.name || person.github}
          </button>
        ))}
      </div>

      {/* Hero card */}
      {personInfo && (
        <div className="bg-white rounded-xl border border-stone-200 p-5">
          <div className="flex flex-col md:flex-row md:items-start gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                <User className="w-5 h-5 text-stone-400" />
                <h2 className="text-lg font-semibold text-stone-800">
                  {personInfo.name || personInfo.github}
                </h2>
              </div>
              <div className="ml-8 flex items-center gap-3">
                {personInfo.role && (
                  <span className="text-sm text-stone-500">{personInfo.role}</span>
                )}
                {personTeams.map((t) => (
                  <span key={t.name} className="flex items-center gap-1.5 text-xs text-stone-400">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: t.color }}
                    />
                    {t.name}
                  </span>
                ))}
              </div>

              <div className="mt-4">
                <span className="text-xs text-stone-500 block mb-2">Contributions Over Time</span>
                <Sparkline data={activityMetric.history} color="#1B6971" width={300} height={80} labels />
              </div>
            </div>

            <div className="md:w-64">
              <span className="text-xs text-stone-500 block mb-2">Recent Activity</span>
              <div className="space-y-1.5">
                {recentActivity.length === 0 ? (
                  <p className="text-xs text-stone-400">No recent activity</p>
                ) : (
                  recentActivity.map((item, i) => (
                    <div key={i} className="text-xs text-stone-600 flex items-start gap-1.5">
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1",
                          item.type === "pr" ? "bg-blue-500" : "bg-green-500",
                        )}
                      />
                      {item.text}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard title="PRs Merged" metric={prsMergedMetric} color="#3b82f6" />
        <MetricCard title="Issues Solved" metric={issuesSolvedMetric} color="#10b981" />
        <MetricCard title="Issues Identified" metric={issuesIdentifiedMetric} color="#d97706" />
      </div>
    </div>
  );
}
