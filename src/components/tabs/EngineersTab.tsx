import { useState, useMemo } from "react";
import { usePeople, useSprint, useFeatures, useAllSprintSubIssues } from "@/hooks/useConfigRepo";
import { useOrgMembers, useAllPRs, useClosedIssues } from "@/hooks/useGitHub";
import { computeEngineerStatus } from "@/lib/metrics";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";

const STATUS_TAG: Record<string, { label: string; bg: string; text: string }> = {
  "on-track": { label: "On Track", bg: "bg-green-100", text: "text-green-700" },
  "at-risk": { label: "At Risk", bg: "bg-amber-100", text: "text-amber-700" },
  "behind": { label: "Behind", bg: "bg-red-100", text: "text-red-700" },
};

export function EngineersTab({ repoNames }: { repoNames: string[] }) {
  const { data: people, isLoading: peopleLoading } = usePeople();
  const { data: sprint } = useSprint();
  const { data: features } = useFeatures();
  const { data: orgMembers } = useOrgMembers();
  const { data: allPRs } = useAllPRs(repoNames);
  const { data: closedIssues } = useClosedIssues(repoNames);

  const [selectedLogin, setSelectedLogin] = useState<string | null>(null);

  const sprintFeatures = useMemo(() => {
    if (!features || !sprint) return [];
    return features.filter((f) => f.sprint === sprint.number);
  }, [features, sprint]);

  const featureIds = useMemo(() => sprintFeatures.map((f) => f.id), [sprintFeatures]);
  const { data: allTasks } = useAllSprintSubIssues(featureIds);

  const featureMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const f of sprintFeatures) m.set(f.id, f.title);
    return m;
  }, [sprintFeatures]);

  const memberAvatars = useMemo(() => {
    const m = new Map<string, string>();
    if (orgMembers) for (const om of orgMembers) m.set(om.login, om.avatar_url);
    return m;
  }, [orgMembers]);

  const engineers = useMemo(() => {
    if (!people) return [];
    return people.map((p) => {
      const myFeatures = sprintFeatures.filter((f) => f.owners.includes(p.github));
      const status = sprint ? computeEngineerStatus(myFeatures, sprint) : ("on-track" as const);
      const prsMerged = allPRs?.filter((pr: any) => pr.user?.login === p.github && pr.merged_at)?.length ?? 0;
      const issuesSolved = closedIssues?.filter((i: any) => i.closed_by === p.github)?.length ?? 0;
      const featuresDone = myFeatures.filter((f) => f.status === "production").length;

      // Tasks (sub-issues) for this engineer
      const myTasks = allTasks?.filter((t) => t.assignees.includes(p.github)) ?? [];
      const tasksDone = myTasks.filter((t) => t.state === "closed").length;
      const tasksOpen = myTasks.filter((t) => t.state === "open").length;

      return { person: p, myFeatures, myTasks, status, prsMerged, issuesSolved, featuresDone, tasksDone, tasksOpen };
    });
  }, [people, sprintFeatures, sprint, allPRs, closedIssues, allTasks]);

  const selected = useMemo(() => {
    const login = selectedLogin ?? engineers[0]?.person.github;
    return engineers.find((e) => e.person.github === login) ?? engineers[0];
  }, [selectedLogin, engineers]);

  if (peopleLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="w-6 h-6 text-brand" />
      </div>
    );
  }

  if (!people?.length) {
    return <div className="text-center py-20 text-stone-400">No people configured. Add team members in Settings.</div>;
  }

  return (
    <div className="flex gap-4 min-h-[600px]">
      {/* Sidebar */}
      <div className="w-64 shrink-0 bg-white dark:bg-stone-800/40 border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-200 dark:border-stone-800">
          <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Engineers</h3>
        </div>
        <div className="divide-y divide-stone-100 dark:divide-stone-800 overflow-y-auto max-h-[560px]">
          {engineers.map((eng) => {
            const avatar = memberAvatars.get(eng.person.github);
            const tag = STATUS_TAG[eng.status];
            const isSelected = eng.person.github === (selected?.person.github);
            return (
              <button
                key={eng.person.github}
                onClick={() => setSelectedLogin(eng.person.github)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer",
                  isSelected ? "bg-stone-100 dark:bg-stone-800" : "hover:bg-stone-50 dark:hover:bg-stone-800/50",
                )}
              >
                {avatar ? (
                  <img src={avatar} className="w-8 h-8 rounded-full shrink-0" alt="" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-stone-200 shrink-0 flex items-center justify-center text-xs font-bold text-stone-500">
                    {eng.person.name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-stone-800 dark:text-stone-200 truncate">{eng.person.name || eng.person.github}</div>
                  <div className="text-xs text-stone-400 truncate">{eng.person.teams[0] ?? eng.person.role}</div>
                </div>
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0", tag.bg, tag.text)}>
                  {tag.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="flex-1 space-y-4">
          {/* Header */}
          <div className="bg-white dark:bg-stone-800/40 border border-stone-200 dark:border-stone-800 rounded-xl p-5 flex items-center gap-4">
            {memberAvatars.get(selected.person.github) ? (
              <img src={memberAvatars.get(selected.person.github)} className="w-12 h-12 rounded-full" alt="" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-stone-200 flex items-center justify-center text-lg font-bold text-stone-500">
                {selected.person.name?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <div>
              <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 font-display">{selected.person.name || selected.person.github}</h2>
              <p className="text-sm text-stone-400">{selected.person.role} · {selected.person.teams.join(", ")}</p>
            </div>
            <div className="ml-auto">
              {(() => {
                const tag = STATUS_TAG[selected.status];
                return <span className={cn("text-xs px-2 py-1 rounded font-medium", tag.bg, tag.text)}>{tag.label}</span>;
              })()}
            </div>
          </div>

          {/* AI Summary */}
          <div className="bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-800 rounded-xl p-4">
            <p className="text-sm text-stone-600 dark:text-stone-300">
              <span className="font-medium text-stone-700 dark:text-stone-200">{selected.person.name || selected.person.github}</span>
              {" has "}
              <span className="font-semibold">{selected.myFeatures.length}</span>
              {" feature"}{selected.myFeatures.length !== 1 ? "s" : ""} this sprint
              {selected.featuresDone > 0 && <>, <span className="font-semibold text-green-600">{selected.featuresDone} complete</span></>}
              {" with "}
              <span className="font-semibold">{selected.myTasks.length}</span>
              {" task"}{selected.myTasks.length !== 1 ? "s" : ""}
              {selected.tasksDone > 0 && <> (<span className="font-semibold text-green-600">{selected.tasksDone} done</span>, <span className="font-semibold text-blue-500">{selected.tasksOpen} open</span>)</>}
              .
            </p>
          </div>

          {/* Metric cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <MetricCard label="PRs Merged" value={selected.prsMerged} color="text-purple-500" />
            <MetricCard label="Issues Solved" value={selected.issuesSolved} color="text-blue-500" />
            <MetricCard label="Features Done" value={selected.featuresDone} color="text-green-500" />
            <MetricCard label="Tasks Done" value={selected.tasksDone} color="text-teal-500" />
            <MetricCard label="Tasks Open" value={selected.tasksOpen} color="text-amber-500" />
          </div>

          {/* Feature Pipeline */}
          <div className="bg-white dark:bg-stone-800/40 border border-stone-200 dark:border-stone-800 rounded-xl p-5">
            <h3 className="font-semibold text-stone-900 dark:text-stone-100 mb-3">Feature Pipeline</h3>
            <div className="space-y-2">
              {(["plan", "demo", "production"] as const).map((status) => {
                const count = selected.myFeatures.filter((f) => f.status === status).length;
                const labels = { plan: "Plan", demo: "In Progress", production: "Complete" };
                const colors = { plan: "#0E7C86", demo: "#F59E0B", production: "#22C55E" };
                const max = Math.max(...["plan", "demo", "production"].map((s) => selected.myFeatures.filter((f) => f.status === s).length), 1);
                return (
                  <div key={status} className="flex items-center gap-3">
                    <span className="text-sm text-stone-500 w-20 shrink-0">{labels[status]}</span>
                    <div className="flex-1 h-5 bg-stone-100 dark:bg-stone-800 rounded overflow-hidden">
                      <div
                        className="h-full rounded transition-all duration-500"
                        style={{
                          width: `${Math.max((count / max) * 100, count > 0 ? 10 : 0)}%`,
                          backgroundColor: colors[status],
                        }}
                      />
                    </div>
                    <span className="text-sm font-medium text-stone-500 w-6 text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Current tasks (sub-issues) */}
          <div className="bg-white dark:bg-stone-800/40 border border-stone-200 dark:border-stone-800 rounded-xl p-5">
            <h3 className="font-semibold text-stone-900 dark:text-stone-100 mb-3">Current Tasks</h3>
            {selected.myTasks.filter((t) => t.state === "open").length > 0 ? (
              <div className="space-y-2">
                {selected.myTasks
                  .filter((t) => t.state === "open")
                  .map((t) => (
                    <div key={t.id} className="flex items-center gap-3 py-2 border-b border-stone-100 dark:border-stone-800 last:border-0">
                      <div className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-stone-700 dark:text-stone-300 block truncate">{t.title}</span>
                        <span className="text-[10px] text-stone-400">{featureMap.get(t.featureId) ?? `Feature #${t.featureId}`}</span>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-sm text-stone-400">No open tasks</p>
            )}
          </div>

          {/* Current features (non-production) */}
          <div className="bg-white dark:bg-stone-800/40 border border-stone-200 dark:border-stone-800 rounded-xl p-5">
            <h3 className="font-semibold text-stone-900 dark:text-stone-100 mb-3">Current Features</h3>
            {selected.myFeatures.filter((f) => f.status !== "production").length > 0 ? (
              <div className="space-y-2">
                {selected.myFeatures
                  .filter((f) => f.status !== "production")
                  .map((f) => (
                    <div key={f.id} className="flex items-center gap-3 py-2 border-b border-stone-100 dark:border-stone-800 last:border-0">
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: f.status === "demo" ? "#F59E0B" : "#0E7C86" }}
                      />
                      <span className="text-sm text-stone-700 dark:text-stone-300 flex-1">{f.title}</span>
                      <span className="text-xs text-stone-400 capitalize">{f.effort}</span>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-sm text-stone-400">All features complete!</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white dark:bg-stone-800/40 border border-stone-200 dark:border-stone-800 rounded-xl p-4">
      <span className="text-xs font-semibold text-stone-400 uppercase tracking-wider">{label}</span>
      <div className={`text-3xl font-bold font-display mt-1 ${color}`}>{value}</div>
    </div>
  );
}
