import { useState, useMemo } from "react";
import { usePeople, useSettings } from "@/hooks/useConfigRepo";
import { useAllPRs, useClosedIssues, useAllIssues, useActiveMembers } from "@/hooks/useGitHub";
import { useAuth } from "@/lib/auth";
import { BarChart } from "@/components/BarChart";
import { computeMetric, extractClosedDates, extractCreatedDates } from "@/lib/metrics";
import type { MetricData } from "@/lib/types";
import { cn } from "@/lib/cn";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { PersonSelect } from "@/components/ui/PersonSelect";

interface IndividualTabProps {
  repoNames: string[];
}

const RANGE_OPTIONS = [
  { label: "1m", weeks: 4 },
  { label: "10w", weeks: 10 },
  { label: "6m", weeks: 26 },
  { label: "1y", weeks: 52 },
] as const;

export function IndividualTab({ repoNames }: IndividualTabProps) {
  const { user } = useAuth();
  const { data: people } = usePeople();
  const { data: settings } = useSettings();
  const { data: orgMembers } = useActiveMembers();
  const [selected, setSelected] = useState<string | null>(null);
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [weeks, setWeeks] = useState(10);

  const teams = useMemo(
    () => settings?.teams ?? [],
    [settings],
  );

  // Fetch all data without date filter — frontend handles date bucketing
  const { data: allPRs, isLoading: prsLoading } = useAllPRs(repoNames);
  const { data: closedIssues, isLoading: closedLoading } = useClosedIssues(repoNames);
  const { data: allIssues, isLoading: allLoading } = useAllIssues(repoNames);

  const isLoading = prsLoading || closedLoading || allLoading;

  // Use people from config, or fall back to org members
  // Sort: current user first, then alphabetical by name
  const personList = useMemo(() => {
    const raw = (people && people.length > 0)
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

  // Default to current user if in the list, otherwise first person
  const selectedPerson = selected
    ?? (user && filteredPersonList.some((p) => p.github.toLowerCase() === user.login.toLowerCase()) ? user.login : null)
    ?? (filteredPersonList.length > 0 ? filteredPersonList[0].github : null);

  // Case-insensitive login match
  const selectedLower = selectedPerson?.toLowerCase();

  // Filter data for selected person
  const personAllPRs = useMemo(
    () => (allPRs ?? []).filter((pr: any) => pr.user?.login?.toLowerCase() === selectedLower),
    [allPRs, selectedLower],
  );

  const personClosedIssues = useMemo(
    () =>
      (closedIssues ?? []).filter((i: any) =>
        (i.assignees ?? []).some((a: any) => a.login?.toLowerCase() === selectedLower),
      ),
    [closedIssues, selectedLower],
  );

  const personCreatedIssues = useMemo(
    () =>
      (allIssues ?? []).filter((i: any) => i.user?.login?.toLowerCase() === selectedLower),
    [allIssues, selectedLower],
  );

  // Metrics
  const prsCreatedMetric = useMemo(
    () => computeMetric(extractCreatedDates(personAllPRs), weeks),
    [personAllPRs, weeks],
  );

  const issuesClosedMetric = useMemo(
    () => computeMetric(extractClosedDates(personClosedIssues), weeks),
    [personClosedIssues, weeks],
  );

  const issuesCreatedMetric = useMemo(
    () => computeMetric(extractCreatedDates(personCreatedIssues), weeks),
    [personCreatedIssues, weeks],
  );

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

      <div className="flex items-center gap-2">
        <PersonSelect
          value={selectedPerson}
          onChange={(v) => setSelected(typeof v === "string" ? v : null)}
          options={filteredPersonList.map((p) => ({ value: p.github, label: p.name || p.github }))}
          placeholder="Select person"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          {/* Activities header + date range selector */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-stone-800">Activities</h2>
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

          {/* Bar chart cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ActivityCard title="PRs Created" metric={prsCreatedMetric} color="#3b82f6" />
            <ActivityCard title="Issues Closed" metric={issuesClosedMetric} color="#10b981" />
            <ActivityCard title="Issues Created" metric={issuesCreatedMetric} color="#d97706" />
          </div>
        </>
      )}
    </div>
  );
}

function ActivityCard({ title, metric, color }: { title: string; metric: MetricData; color: string }) {
  const total = metric.history.reduce((sum, b) => sum + b.value, 0);
  const isPositive = metric.change > 0;
  const isNeutral = metric.change === 0;

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4">
      <div className="text-xs font-medium text-stone-500 uppercase tracking-wider mb-2">
        {title}
      </div>
      <div className="flex items-end justify-between mb-3">
        <span className="text-3xl font-semibold text-stone-800" style={{ color }}>
          {total}
        </span>
        {!isNeutral ? (
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
        ) : (
          <span className="flex items-center gap-0.5 text-xs text-stone-400">
            <Minus className="w-3 h-3" />
            No change
          </span>
        )}
      </div>
      <BarChart data={metric.history} color={color} />
    </div>
  );
}
