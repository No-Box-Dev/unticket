import { useState, useMemo } from "react";
import { usePeople, useSprint, useFeatures, useAllSprintSubIssues } from "@/hooks/useConfigRepo";
import { useActiveMembers, useAllPRs, useClosedIssues, usePRsForFeature } from "@/hooks/useGitHub";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import { ChevronDown, ChevronRight, GitPullRequest, GitMerge, ExternalLink } from "lucide-react";
import type { Person, Feature } from "@/lib/types";
import type { SubIssueWithFeature } from "@/hooks/useConfigRepo";

type ViewMode = "features" | "roles" | "tasks";

export function EngineersTab({ repoNames, navFilter }: { repoNames: string[]; navFilter?: import("@/lib/types").NavFilter | null }) {
  const { data: people } = usePeople();
  const { data: sprint } = useSprint();
  const { data: features } = useFeatures();
  const { data: orgMembers, isLoading: membersLoading } = useActiveMembers();
  const { data: allPRs } = useAllPRs(repoNames);
  const { data: closedIssues } = useClosedIssues(repoNames);

  const [selectedLogin, setSelectedLogin] = useState<string | null>(navFilter?.person ?? null);
  const [viewMode, setViewMode] = useState<ViewMode>("features");

  const sprintFeatures = useMemo(() => {
    if (!features || !sprint) return [];
    return features.filter((f) => f.sprint === sprint.number);
  }, [features, sprint]);

  const featureIds = useMemo(() => sprintFeatures.map((f) => f.id), [sprintFeatures]);
  const { data: allTasks } = useAllSprintSubIssues(featureIds);

  const featureMap = useMemo(() => {
    const m = new Map<number, Feature>();
    for (const f of sprintFeatures) m.set(f.id, f);
    return m;
  }, [sprintFeatures]);

  // Build engineer list
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

      // Roles: unique role names from tasks
      const myRoles = [...new Map(
        myTasks.filter((t) => t.roleName).map((t) => [t.roleNumber!, { number: t.roleNumber!, name: t.roleName!, featureId: t.featureId }])
      ).values()];

      return {
        login: member.login,
        avatar_url: member.avatar_url,
        name: person?.name ?? member.login,
        role: person?.role ?? "",
        team: person?.team ?? "",
        description: person?.description ?? "",
        myFeatures,
        myTasks,
        myRoles,
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
    <div className="flex flex-col lg:flex-row gap-4 min-h-[600px]">
      {/* Sidebar */}
      <div className="w-full lg:w-64 lg:shrink-0 bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-xl overflow-hidden self-start sticky top-4">
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
                  <div className="text-xs text-stone-400 truncate">{eng.team || eng.role}</div>
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
              {(selected.role || selected.team) && (
                <p className="text-sm text-stone-400">{[selected.role, selected.team].filter(Boolean).join(" · ")}</p>
              )}
              {selected.description && (
                <p className="text-sm text-stone-500 dark:text-neutral-400 mt-0.5">{selected.description}</p>
              )}
            </div>
          </div>

          {/* Summary */}
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
              {selected.myRoles.length > 0 && <> across <span className="font-semibold">{selected.myRoles.length}</span> role{selected.myRoles.length !== 1 ? "s" : ""}</>}
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

          {/* View selector + work items */}
          <div className="bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
            <div className="flex items-center border-b border-stone-200 dark:border-white/[0.06]">
              {(["features", "roles", "tasks"] as const).map((mode) => {
                const counts = { features: selected.myFeatures.length, roles: selected.myRoles.length, tasks: selected.myTasks.length };
                return (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={cn(
                      "px-4 py-3 text-sm font-medium capitalize transition-colors cursor-pointer",
                      viewMode === mode
                        ? "text-brand border-b-2 border-brand"
                        : "text-stone-500 dark:text-neutral-400 hover:text-stone-700 dark:hover:text-neutral-200",
                    )}
                  >
                    {mode} ({counts[mode]})
                  </button>
                );
              })}
            </div>

            <div className="p-4">
              {viewMode === "features" && (
                <FeaturesView features={selected.myFeatures} tasks={selected.myTasks} />
              )}
              {viewMode === "roles" && (
                <RolesView roles={selected.myRoles} tasks={selected.myTasks} featureMap={featureMap} />
              )}
              {viewMode === "tasks" && (
                <TasksView tasks={selected.myTasks} featureMap={featureMap} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- View Components ----------

const STATUS_COLORS: Record<string, string> = {
  plan: "bg-brand", in_progress: "bg-amber-500", demo: "bg-purple-500",
  tested: "bg-cyan-500", production: "bg-green-500", future: "bg-stone-300",
};
const STATUS_LABELS: Record<string, string> = {
  plan: "Plan", in_progress: "In Progress", demo: "Demo",
  tested: "Tested", production: "Production", future: "Future",
};

function FeaturesView({ features, tasks }: {
  features: Feature[];
  tasks: SubIssueWithFeature[];
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (features.length === 0) return <p className="text-sm text-stone-400">No features assigned</p>;

  return (
    <div className="space-y-1">
      {features.map((f) => {
        const isExpanded = expandedId === f.id;
        const featureTasks = tasks.filter((t) => t.featureId === f.id);
        const doneCount = featureTasks.filter((t) => t.state === "closed").length;
        return (
          <div key={f.id}>
            <button
              onClick={() => setExpandedId(isExpanded ? null : f.id)}
              className="w-full flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-stone-50 dark:hover:bg-white/[0.06] cursor-pointer text-left"
            >
              {isExpanded ? <ChevronDown size={14} className="text-stone-400 shrink-0" /> : <ChevronRight size={14} className="text-stone-400 shrink-0" />}
              <span className={cn("w-2 h-2 rounded-full shrink-0", STATUS_COLORS[f.status])} />
              <span className="text-sm text-stone-700 dark:text-neutral-300 flex-1 truncate">{f.title}</span>
              <span className="text-xs text-stone-400">{STATUS_LABELS[f.status]}</span>
              {featureTasks.length > 0 && (
                <span className="text-xs text-stone-400">{doneCount}/{featureTasks.length}</span>
              )}
            </button>
            {isExpanded && (
              <FeatureDetail featureId={f.id} tasks={featureTasks} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function RolesView({ roles, tasks, featureMap }: {
  roles: { number: number; name: string; featureId: number }[];
  tasks: SubIssueWithFeature[];
  featureMap: Map<number, Feature>;
}) {
  const [expandedRole, setExpandedRole] = useState<number | null>(null);

  if (roles.length === 0) return <p className="text-sm text-stone-400">No roles assigned</p>;

  return (
    <div className="space-y-1">
      {roles.map((role) => {
        const isExpanded = expandedRole === role.number;
        const roleTasks = tasks.filter((t) => t.roleNumber === role.number);
        const doneCount = roleTasks.filter((t) => t.state === "closed").length;
        const feature = featureMap.get(role.featureId);
        return (
          <div key={role.number}>
            <button
              onClick={() => setExpandedRole(isExpanded ? null : role.number)}
              className="w-full flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-stone-50 dark:hover:bg-white/[0.06] cursor-pointer text-left"
            >
              {isExpanded ? <ChevronDown size={14} className="text-stone-400 shrink-0" /> : <ChevronRight size={14} className="text-stone-400 shrink-0" />}
              <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
              <span className="text-sm text-stone-700 dark:text-neutral-300 flex-1 truncate">{role.name}</span>
              {feature && <span className="text-xs text-stone-400 truncate max-w-[150px]">{feature.title}</span>}
              {roleTasks.length > 0 && (
                <span className="text-xs text-stone-400">{doneCount}/{roleTasks.length}</span>
              )}
            </button>
            {isExpanded && (
              <div className="ml-7 mb-2">
                <FeatureDetail featureId={role.featureId} tasks={roleTasks} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TasksView({ tasks, featureMap }: {
  tasks: SubIssueWithFeature[];
  featureMap: Map<number, Feature>;
}) {
  const [expandedFeatureId, setExpandedFeatureId] = useState<number | null>(null);

  if (tasks.length === 0) return <p className="text-sm text-stone-400">No tasks assigned</p>;

  // Group tasks by feature
  const grouped = useMemo(() => {
    const map = new Map<number, SubIssueWithFeature[]>();
    for (const t of tasks) {
      const list = map.get(t.featureId) ?? [];
      list.push(t);
      map.set(t.featureId, list);
    }
    return [...map.entries()];
  }, [tasks]);

  return (
    <div className="space-y-1">
      {grouped.map(([featureId, featureTasks]) => {
        const feature = featureMap.get(featureId);
        const isExpanded = expandedFeatureId === featureId;
        const doneCount = featureTasks.filter((t) => t.state === "closed").length;
        return (
          <div key={featureId}>
            <button
              onClick={() => setExpandedFeatureId(isExpanded ? null : featureId)}
              className="w-full flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-stone-50 dark:hover:bg-white/[0.06] cursor-pointer text-left"
            >
              {isExpanded ? <ChevronDown size={14} className="text-stone-400 shrink-0" /> : <ChevronRight size={14} className="text-stone-400 shrink-0" />}
              <span className={cn("w-2 h-2 rounded-full shrink-0", STATUS_COLORS[feature?.status ?? "plan"])} />
              <span className="text-xs text-stone-500 dark:text-neutral-400 shrink-0">{feature?.title ?? `Feature #${featureId}`}</span>
              <span className="text-xs text-stone-400 ml-auto">{doneCount}/{featureTasks.length}</span>
            </button>
            {isExpanded && (
              <div className="ml-7 space-y-1 mb-2">
                {featureTasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 py-1.5 px-2">
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", t.state === "closed" ? "bg-green-500" : "bg-blue-400")} />
                    <span className={cn("text-sm flex-1 truncate", t.state === "closed" ? "text-stone-400 line-through" : "text-stone-700 dark:text-neutral-300")}>{t.title}</span>
                    {t.roleName && <span className="text-[10px] text-stone-400">{t.roleName}</span>}
                    {t.points && <span className="text-[10px] font-medium bg-brand/10 text-brand px-1.5 py-0.5 rounded">{t.points}pt</span>}
                  </div>
                ))}
                <LinkedPRsPanel featureId={featureId} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Linked PRs Panel ----------

function FeatureDetail({ featureId, tasks }: { featureId: number; tasks: SubIssueWithFeature[] }) {
  return (
    <div className="ml-7 mb-2 space-y-1">
      {tasks.length > 0 && (
        <div className="space-y-1">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2 py-1.5 px-2">
              <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", t.state === "closed" ? "bg-green-500" : "bg-blue-400")} />
              <span className={cn("text-sm flex-1 truncate", t.state === "closed" ? "text-stone-400 line-through" : "text-stone-700 dark:text-neutral-300")}>{t.title}</span>
              {t.roleName && <span className="text-[10px] text-stone-400">{t.roleName}</span>}
              {t.points && <span className="text-[10px] font-medium bg-brand/10 text-brand px-1.5 py-0.5 rounded">{t.points}pt</span>}
            </div>
          ))}
        </div>
      )}
      <LinkedPRsPanel featureId={featureId} />
    </div>
  );
}

function LinkedPRsPanel({ featureId }: { featureId: number }) {
  const { data: prs, isLoading } = usePRsForFeature(featureId);

  if (isLoading) return <div className="py-2 px-2"><Spinner className="w-4 h-4 text-stone-400" /></div>;
  if (!prs || prs.length === 0) return null;

  return (
    <div className="border-t border-stone-100 dark:border-white/[0.06] pt-2 mt-1">
      <span className="text-[10px] text-stone-400 dark:text-neutral-500 uppercase tracking-wider px-2">Linked PRs</span>
      <div className="space-y-0.5 mt-1">
        {prs.map((pr) => {
          const isMerged = pr.state === "closed" || (pr as any).merged_at;
          const source = (pr as any).linkSource as string | undefined;
          return (
            <a
              key={pr.id}
              href={pr.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-stone-50 dark:hover:bg-white/[0.06] group"
            >
              {isMerged
                ? <GitMerge size={12} className="text-purple-500 shrink-0" />
                : <GitPullRequest size={12} className="text-green-500 shrink-0" />
              }
              <span className="text-xs text-stone-400 shrink-0">{pr.repo}#{pr.number}</span>
              <span className="text-xs text-stone-600 dark:text-neutral-300 truncate flex-1">{pr.title}</span>
              {source && (
                <span className={cn("text-[9px] px-1 py-0.5 rounded-full shrink-0",
                  source === "branch" ? "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400" : "bg-stone-100 dark:bg-white/[0.06] text-stone-500"
                )}>{source}</span>
              )}
              <ExternalLink size={10} className="text-stone-300 opacity-0 group-hover:opacity-100 shrink-0" />
            </a>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Metric Card ----------

function MetricCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-xl p-4">
      <span className="text-xs font-semibold text-stone-400 uppercase tracking-wider">{label}</span>
      <div className={`text-3xl font-bold font-display mt-1 ${color}`}>{value}</div>
    </div>
  );
}
