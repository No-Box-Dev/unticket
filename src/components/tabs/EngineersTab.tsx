import { useState, useMemo } from "react";
import { usePeople, useSprint, useFeatures, useAllSprintSubIssues } from "@/hooks/useConfigRepo";
import { useOrgMembers, useAllPRs, useClosedIssues } from "@/hooks/useGitHub";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import type { Person } from "@/lib/types";

export function EngineersTab({ repoNames }: { repoNames: string[] }) {
  const { data: people } = usePeople();
  const { data: sprint } = useSprint();
  const { data: features } = useFeatures();
  const { data: orgMembers, isLoading: membersLoading } = useOrgMembers();
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

  // Build a unified list: all org members, enriched with people config if available
  const engineers = useMemo(() => {
    if (!orgMembers) return [];

    const peopleMap = new Map<string, Person>();
    for (const p of people ?? []) peopleMap.set(p.github, p);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoff = thirtyDaysAgo.toISOString();

    return orgMembers.map((member) => {
      const person = peopleMap.get(member.login);
      const myFeatures = sprintFeatures.filter((f) => f.owners.includes(member.login));
      const prsMerged = allPRs?.filter((pr: any) => pr.user?.login === member.login && pr.merged_at && pr.merged_at >= cutoff)?.length ?? 0;
      const issuesSolved = closedIssues?.filter((i: any) => i.closed_by === member.login && i.closed_at && i.closed_at >= cutoff)?.length ?? 0;
      const featuresDone = myFeatures.filter((f) => f.status === "production").length;

      const myTasks = allTasks?.filter((t) => t.assignees.includes(member.login)) ?? [];
      const tasksDone = myTasks.filter((t) => t.state === "closed").length;
      const tasksOpen = myTasks.filter((t) => t.state === "open").length;

      return {
        login: member.login,
        avatar_url: member.avatar_url,
        name: person?.name ?? member.login,
        role: person?.role ?? "",
        teams: person?.teams ?? [],
        myFeatures,
        myTasks,
        prsMerged,
        issuesSolved,
        featuresDone,
        tasksDone,
        tasksOpen,
      };
    });
  }, [orgMembers, people, sprintFeatures, allPRs, closedIssues, allTasks]);

  const selected = useMemo(() => {
    const login = selectedLogin ?? engineers[0]?.login;
    return engineers.find((e) => e.login === login) ?? engineers[0];
  }, [selectedLogin, engineers]);

  if (membersLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="w-6 h-6 text-brand" />
      </div>
    );
  }

  if (!engineers.length) {
    return <div className="text-center py-20 text-stone-400">No organization members found.</div>;
  }

  return (
    <div className="flex gap-4 min-h-[600px]">
      {/* Sidebar */}
      <div className="w-64 shrink-0 bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-xl overflow-hidden self-start sticky top-4">
        <div className="px-4 py-3 border-b border-stone-200 dark:border-white/[0.06]">
          <h3 className="text-sm font-semibold text-stone-700 dark:text-neutral-200">Engineers ({engineers.length})</h3>
        </div>
        <div className="divide-y divide-stone-100 dark:divide-white/[0.06] overflow-y-auto max-h-[calc(100vh-10rem)]">
          {engineers.map((eng) => {
            const isSelected = eng.login === selected?.login;
            return (
              <button
                key={eng.login}
                onClick={() => setSelectedLogin(eng.login)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer",
                  isSelected ? "bg-stone-100 dark:bg-dark-overlay" : "hover:bg-stone-50 dark:hover:bg-white/[0.06]",
                )}
              >
                {eng.avatar_url ? (
                  <img src={eng.avatar_url} className="w-8 h-8 rounded-full shrink-0" alt="" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-stone-200 shrink-0 flex items-center justify-center text-xs font-bold text-stone-500">
                    {eng.name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-stone-800 dark:text-neutral-200 truncate">{eng.name}</div>
                  <div className="text-xs text-stone-400 truncate">{eng.teams[0] ?? eng.role}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="flex-1 space-y-4">
          {/* Header */}
          <div className="bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-xl p-5 flex items-center gap-4">
            {selected.avatar_url ? (
              <img src={selected.avatar_url} className="w-12 h-12 rounded-full" alt="" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-stone-200 flex items-center justify-center text-lg font-bold text-stone-500">
                {selected.name?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <div>
              <h2 className="text-lg font-bold text-stone-900 dark:text-neutral-100 font-display">{selected.name}</h2>
              {(selected.role || selected.teams.length > 0) && (
                <p className="text-sm text-stone-400">{[selected.role, selected.teams.join(", ")].filter(Boolean).join(" · ")}</p>
              )}
            </div>
          </div>

          {/* AI Summary */}
          <div className="bg-stone-50 dark:bg-white/[0.04] border border-stone-200 dark:border-white/[0.06] rounded-xl p-4">
            <p className="text-sm text-stone-600 dark:text-neutral-300">
              <span className="font-medium text-stone-700 dark:text-neutral-200">{selected.name}</span>
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
          <div className="mb-1">
            <span className="text-[10px] text-stone-400 dark:text-neutral-500 uppercase tracking-wider">Last 30 days</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <MetricCard label="PRs Merged" value={selected.prsMerged} color="text-purple-500" />
            <MetricCard label="Issues Solved" value={selected.issuesSolved} color="text-blue-500" />
            <MetricCard label="Features Done" value={selected.featuresDone} color="text-green-500" />
            <MetricCard label="Tasks Done" value={selected.tasksDone} color="text-teal-500" />
            <MetricCard label="Tasks Open" value={selected.tasksOpen} color="text-amber-500" />
          </div>

          {/* Feature Pipeline */}
          <div className="bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-xl p-5">
            <h3 className="font-semibold text-stone-900 dark:text-neutral-100 mb-3">Feature Pipeline</h3>
            <div className="space-y-2">
              {(["plan", "in_progress", "demo", "tested", "production"] as const).map((status) => {
                const count = selected.myFeatures.filter((f) => f.status === status).length;
                const labels = { plan: "Plan", in_progress: "In Progress", demo: "Demo", tested: "Tested", production: "In Production" };
                const colors = { plan: "#0E7C86", in_progress: "#F59E0B", demo: "#A855F7", tested: "#06B6D4", production: "#22C55E" };
                const max = Math.max(...["plan", "in_progress", "demo", "tested", "production"].map((s) => selected.myFeatures.filter((f) => f.status === s).length), 1);
                return (
                  <div key={status} className="flex items-center gap-3">
                    <span className="text-sm text-stone-500 w-20 shrink-0">{labels[status]}</span>
                    <div className="flex-1 h-5 bg-stone-100 dark:bg-dark-overlay rounded overflow-hidden">
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
          <div className="bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-xl p-5">
            <h3 className="font-semibold text-stone-900 dark:text-neutral-100 mb-3">Current Tasks</h3>
            {selected.myTasks.filter((t) => t.state === "open").length > 0 ? (
              <div className="space-y-2">
                {selected.myTasks
                  .filter((t) => t.state === "open")
                  .map((t) => (
                    <div key={t.id} className="flex items-center gap-3 py-2 border-b border-stone-100 dark:border-white/[0.06] last:border-0">
                      <div className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-stone-700 dark:text-neutral-300 block truncate">{t.title}</span>
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
          <div className="bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-xl p-5">
            <h3 className="font-semibold text-stone-900 dark:text-neutral-100 mb-3">Current Features</h3>
            {selected.myFeatures.filter((f) => f.status !== "production").length > 0 ? (
              <div className="space-y-2">
                {selected.myFeatures
                  .filter((f) => f.status !== "production")
                  .map((f) => (
                    <div key={f.id} className="flex items-center gap-3 py-2 border-b border-stone-100 dark:border-white/[0.06] last:border-0">
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: f.status === "demo" ? "#F59E0B" : "#0E7C86" }}
                      />
                      <span className="text-sm text-stone-700 dark:text-neutral-300 flex-1">{f.title}</span>
                      <span className="text-xs text-stone-400 capitalize">{f.priority ?? "—"}</span>
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
    <div className="bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-xl p-4">
      <span className="text-xs font-semibold text-stone-400 uppercase tracking-wider">{label}</span>
      <div className={`text-3xl font-bold font-display mt-1 ${color}`}>{value}</div>
    </div>
  );
}
