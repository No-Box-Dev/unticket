/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from "react";
import { usePeople, useSprint, useFeatures, useAllSprintSubIssues } from "@/hooks/useConfigRepo";
import { useActiveMembers, useAllPRs, useClosedIssues, usePRsForFeature } from "@/hooks/useGitHub";
import { Spinner } from "@/components/Spinner";
import { PersonSelect } from "@/components/ui/PersonSelect";
import { cn } from "@/lib/cn";
import { ChevronDown, ChevronRight, GitPullRequest, GitMerge, CircleCheck, ExternalLink } from "lucide-react";
import type { Person, Feature } from "@/lib/types";
import type { SubIssueWithFeature } from "@/hooks/useConfigRepo";

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

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

  // Build chronological activity feed for the selected engineer (last 30 days).
  const feed = useMemo<FeedItem[]>(() => {
    if (!selected) return [];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    const cutoff = cutoffDate.getTime();
    const items: FeedItem[] = [];

    for (const pr of allPRs ?? []) {
      const p = pr as any;
      if (p.user?.login !== selected.login) continue;
      if (p.merged_at && new Date(p.merged_at).getTime() >= cutoff) {
        items.push({ kind: "pr_merged", at: p.merged_at, repo: p.repo, number: p.number, title: p.title, html_url: p.html_url });
      } else if (!p.merged_at && p.created_at && new Date(p.created_at).getTime() >= cutoff) {
        items.push({ kind: "pr_opened", at: p.created_at, repo: p.repo, number: p.number, title: p.title, html_url: p.html_url });
      }
    }

    for (const issue of closedIssues ?? []) {
      const i = issue as any;
      if (i.closed_by !== selected.login) continue;
      if (i.closed_at && new Date(i.closed_at).getTime() >= cutoff) {
        items.push({ kind: "issue_closed", at: i.closed_at, repo: i.repo, number: i.number, title: i.title, html_url: i.html_url });
      }
    }

    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return items;
  }, [selected, allPRs, closedIssues]);

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
    <div className="space-y-4">
      {/* Engineer picker */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-stone-500 dark:text-neutral-400">Engineer</span>
        <PersonSelect
          value={selected?.login ?? null}
          onChange={(v) => setSelectedLogin(typeof v === "string" ? v : null)}
          options={engineers.map((e) => ({ value: e.login, label: e.name }))}
          placeholder="Select engineer"
        />
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="space-y-4">
          {/* Header with embedded metrics */}
          <div className="bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-xl p-5 flex flex-col lg:flex-row lg:items-center gap-4">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              {selected.avatar_url ? (
                <img src={selected.avatar_url} className="w-12 h-12 rounded-full shrink-0" alt="" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-stone-200 shrink-0 flex items-center justify-center text-lg font-bold text-stone-500">
                  {selected.name?.[0]?.toUpperCase() ?? "?"}
                </div>
              )}
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-stone-900 dark:text-neutral-100 font-display truncate">{selected.name}</h2>
                {(selected.role || selected.team) && (
                  <p className="text-sm text-stone-400 truncate">{[selected.role, selected.team].filter(Boolean).join(" · ")}</p>
                )}
                {selected.description && (
                  <p className="text-sm text-stone-500 dark:text-neutral-400 mt-0.5 line-clamp-2">{selected.description}</p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-stretch gap-x-4 gap-y-3 lg:border-l lg:border-stone-200 lg:dark:border-white/[0.06] lg:pl-4">
              <InlineMetric label="PRs" value={selected.prsMerged} color="text-purple-500" />
              <InlineMetric label="Issues" value={selected.issuesSolved} color="text-blue-500" />
              <InlineMetric label="Features" value={selected.featuresDone} color="text-green-500" />
              <InlineMetric label="Tasks done" value={selected.tasksDone} color="text-teal-500" />
              <InlineMetric label="Tasks open" value={selected.tasksOpen} color="text-amber-500" />
            </div>
          </div>

          {/* Activity feed */}
          <ActivityFeed items={feed} />

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

  if (tasks.length === 0) return <p className="text-sm text-stone-400">No tasks assigned</p>;

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

// ---------- Inline Metric (embedded in header) ----------

function InlineMetric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-start">
      <span className={`text-xl font-bold font-display leading-none ${color}`}>{value}</span>
      <span className="text-[10px] font-medium text-stone-400 uppercase tracking-wider mt-1">{label}</span>
    </div>
  );
}

// ---------- Activity Feed ----------

type FeedItem =
  | { kind: "pr_merged" | "pr_opened"; at: string; repo: string; number: number; title: string; html_url: string }
  | { kind: "issue_closed"; at: string; repo: string; number: number; title: string; html_url: string };

function ActivityFeed({ items }: { items: FeedItem[] }) {
  const [filter, setFilter] = useState<"all" | "prs" | "issues">("all");

  const visible = useMemo(() => {
    if (filter === "prs") return items.filter((i) => i.kind === "pr_merged" || i.kind === "pr_opened");
    if (filter === "issues") return items.filter((i) => i.kind === "issue_closed");
    return items;
  }, [items, filter]);

  const counts = useMemo(() => ({
    all: items.length,
    prs: items.filter((i) => i.kind === "pr_merged" || i.kind === "pr_opened").length,
    issues: items.filter((i) => i.kind === "issue_closed").length,
  }), [items]);

  return (
    <div className="bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 dark:border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          <h3 className="text-sm font-semibold text-stone-700 dark:text-neutral-200">Live activity</h3>
          <span className="text-xs text-stone-400">last 30 days</span>
        </div>
        <div className="flex items-center gap-1 text-xs">
          {(["all", "prs", "issues"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-2 py-1 rounded transition-colors capitalize cursor-pointer",
                filter === f
                  ? "bg-brand/10 text-brand"
                  : "text-stone-500 dark:text-neutral-400 hover:bg-stone-100 dark:hover:bg-white/[0.06]",
              )}
            >
              {f === "prs" ? "PRs" : f} ({counts[f]})
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="p-6 text-center text-sm text-stone-400">No activity in the last 30 days.</div>
      ) : (
        <ol className="divide-y divide-stone-100 dark:divide-white/[0.06] max-h-[420px] overflow-y-auto">
          {visible.map((item) => (
            <li key={`${item.kind}:${item.repo}#${item.number}:${item.at}`}>
              <a
                href={item.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50 dark:hover:bg-white/[0.06] group"
              >
                <FeedIcon kind={item.kind} />
                <span className="text-xs text-stone-400 shrink-0 font-mono">{item.repo}#{item.number}</span>
                <span className="text-sm text-stone-700 dark:text-neutral-300 truncate flex-1">{item.title}</span>
                <span className="text-xs text-stone-400 shrink-0">{labelFor(item.kind)}</span>
                <span className="text-xs text-stone-400 shrink-0 w-16 text-right">{formatRelative(item.at)}</span>
                <ExternalLink size={12} className="text-stone-300 opacity-0 group-hover:opacity-100 shrink-0" />
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function FeedIcon({ kind }: { kind: FeedItem["kind"] }) {
  if (kind === "pr_merged") return <GitMerge size={14} className="text-purple-500 shrink-0" />;
  if (kind === "pr_opened") return <GitPullRequest size={14} className="text-green-500 shrink-0" />;
  return <CircleCheck size={14} className="text-blue-500 shrink-0" />;
}

function labelFor(kind: FeedItem["kind"]) {
  if (kind === "pr_merged") return "merged PR";
  if (kind === "pr_opened") return "opened PR";
  return "closed issue";
}
