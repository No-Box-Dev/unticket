import { useMemo, useState } from "react";
import { useActiveMembers } from "@/hooks/useGitHub";
import { useFeatures, useSprint, useAllSprintSubIssues, usePeople } from "@/hooks/useConfigRepo";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { FeatureStatus } from "@/lib/types";
import type { SubIssueWithFeature } from "@/hooks/useConfigRepo";

const card = "bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-xl";

const STATUS_COLORS: Record<FeatureStatus, { bg: string; dot: string; text: string; label: string }> = {
  plan: { bg: "bg-brand/10", dot: "bg-brand", text: "text-brand", label: "Plan" },
  in_progress: { bg: "bg-amber-50 dark:bg-amber-900/20", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", label: "In Progress" },
  demo: { bg: "bg-purple-50 dark:bg-purple-900/20", dot: "bg-purple-500", text: "text-purple-600 dark:text-purple-400", label: "Demo" },
  tested: { bg: "bg-cyan-50 dark:bg-cyan-900/20", dot: "bg-cyan-500", text: "text-cyan-600 dark:text-cyan-400", label: "Tested" },
  production: { bg: "bg-green-50 dark:bg-green-900/20", dot: "bg-green-500", text: "text-green-600 dark:text-green-400", label: "Production" },
  future: { bg: "bg-stone-50 dark:bg-white/[0.04]", dot: "bg-stone-300", text: "text-stone-500", label: "Future" },
};

const PERSON_COLORS = [
  "#0E7C86", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444",
  "#ec4899", "#14b8a6", "#06b6d4", "#84cc16", "#f97316",
];

const ON_TRACK_THRESHOLD = -0.1;
const AT_RISK_THRESHOLD = -0.3;

const STATUS_BADGE_STYLES = {
  "on-track": "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
  "at-risk": "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
  "behind": "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
} as const;

function getPaceStatus(donePoints: number, totalPoints: number, elapsedPct: number): "on-track" | "at-risk" | "behind" {
  if (totalPoints === 0) return "on-track";
  const diff = (donePoints / totalPoints) - elapsedPct;
  if (diff >= ON_TRACK_THRESHOLD) return "on-track";
  if (diff >= AT_RISK_THRESHOLD) return "at-risk";
  return "behind";
}

interface EngineerWorkload {
  login: string;
  name: string;
  team: string;
  avatar_url: string | null;
  totalPoints: number;
  donePoints: number;
  totalTasks: number;
  doneTasks: number;
  features: { id: number; title: string; status: FeatureStatus }[];
  tasks: SubIssueWithFeature[];
}

export function WorkloadTab(_: { repoNames: string[] }) {
  const { data: orgMembers, isLoading } = useActiveMembers();
  const { data: features } = useFeatures();
  const { data: sprint } = useSprint();
  const { data: people } = usePeople();
  const [expandedPerson, setExpandedPerson] = useState<string | null>(null);

  const sprintFeatures = useMemo(() => {
    if (!features || !sprint) return [];
    return features.filter((f) => f.sprint === sprint.number && f.status !== "future");
  }, [features, sprint]);

  const sprintFeatureIds = useMemo(() => sprintFeatures.map((f) => f.id), [sprintFeatures]);
  const { data: allTasks, isLoading: tasksLoading } = useAllSprintSubIssues(sprintFeatureIds);

  const engineers = useMemo((): EngineerWorkload[] => {
    if (!orgMembers) return [];
    const peopleMap = new Map((people ?? []).map((p) => [p.github, p]));

    // Filter out role sub-issues and tasks closed before sprint started
    const sprintStart = sprint?.startDate ?? "";
    const actualTasks = (allTasks ?? []).filter((t) => {
      // Exclude role sub-issues (same logic as sprint board)
      if (t.roleNumber !== undefined && t.roleName === undefined) return false;
      // Exclude tasks closed before sprint started (carried over, already done)
      if (t.state === "closed" && t.closed_at && t.closed_at < sprintStart) return false;
      return true;
    });
    const tasksByPerson = new Map<string, { done: number; total: number; points: number; donePoints: number; tasks: SubIssueWithFeature[] }>();
    for (const t of actualTasks) {
      for (const a of t.assignees) {
        const entry = tasksByPerson.get(a) ?? { done: 0, total: 0, points: 0, donePoints: 0, tasks: [] };
        entry.total++;
        entry.points += t.points ?? 0;
        if (t.state === "closed") { entry.done++; entry.donePoints += t.points ?? 0; }
        entry.tasks.push(t);
        tasksByPerson.set(a, entry);
      }
    }

    const featuresByPerson = new Map<string, { id: number; title: string; status: FeatureStatus }[]>();
    for (const f of sprintFeatures) {
      for (const o of f.owners) {
        if (!featuresByPerson.has(o)) featuresByPerson.set(o, []);
        featuresByPerson.get(o)!.push({ id: f.id, title: f.title, status: f.status });
      }
    }

    return orgMembers.map((m: any) => {
      const person = peopleMap.get(m.login);
      const tasks = tasksByPerson.get(m.login) ?? { done: 0, total: 0, points: 0, donePoints: 0, tasks: [] };
      const personFeatures = featuresByPerson.get(m.login) ?? [];
      return {
        login: m.login,
        name: person?.name ?? m.login,
        team: person?.team ?? "",
        avatar_url: m.avatar_url,
        totalPoints: tasks.points,
        donePoints: tasks.donePoints,
        totalTasks: tasks.total,
        doneTasks: tasks.done,
        features: personFeatures,
        tasks: tasks.tasks,
      };
    })
    .filter((e) => e.totalPoints > 0 || e.totalTasks > 0 || e.features.length > 0)
    .sort((a, b) => b.totalPoints - a.totalPoints);
  }, [orgMembers, people, allTasks, sprintFeatures]);

  const totals = useMemo(() => {
    const t = { points: 0, donePoints: 0, tasks: 0, doneTasks: 0 };
    for (const e of engineers) {
      t.points += e.totalPoints;
      t.donePoints += e.donePoints;
      t.tasks += e.totalTasks;
      t.doneTasks += e.doneTasks;
    }
    return t;
  }, [engineers]);

  const featureStatusBreakdown = useMemo(() => {
    const counts = new Map<FeatureStatus, number>();
    for (const f of sprintFeatures) counts.set(f.status, (counts.get(f.status) ?? 0) + 1);
    return Array.from(counts.entries()).map(([status, count]) => ({ status, count }));
  }, [sprintFeatures]);

  const elapsedPct = useMemo(() => {
    if (!sprint?.startDate || !sprint?.endDate) return 0;
    const now = new Date();
    const start = new Date(sprint.startDate + "T00:00:00");
    const end = new Date(sprint.endDate + "T23:59:59");
    return Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / Math.max(1, end.getTime() - start.getTime())));
  }, [sprint]);


  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Spinner className="w-6 h-6 text-brand" /></div>;
  }

  if (engineers.length === 0) {
    return (
      <div className="text-center py-20 text-stone-400 dark:text-neutral-500">
        No sprint workload data. Assign tasks and points to see workload distribution.
      </div>
    );
  }

  const pointsPct = totals.points > 0 ? Math.round((totals.donePoints / totals.points) * 100) : 0;
  const tasksPct = totals.tasks > 0 ? Math.round((totals.doneTasks / totals.tasks) * 100) : 0;
  const sprintPct = Math.round(elapsedPct * 100);
  const sprintTotalDays = sprint ? Math.round((new Date(sprint.endDate + "T23:59:59").getTime() - new Date(sprint.startDate + "T00:00:00").getTime()) / 86400000) : 0;
  const sprintElapsedDays = Math.max(1, Math.round(elapsedPct * sprintTotalDays));
  const shippedCount = sprintFeatures.filter((f) => f.status === "production").length;

  return (
    <div className="space-y-5">
      {/* Sprint header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-800 dark:text-neutral-200 font-display">
            Sprint Workload {sprint ? `— ${sprint.name}` : ""}
          </h2>
          {sprint && (
            <p className="text-xs text-stone-400 dark:text-neutral-500 mt-0.5">
              {new Date(sprint.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {new Date(sprint.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · Day {sprintElapsedDays} of {sprintTotalDays}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-stone-400 dark:text-neutral-500">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-brand inline-block" /> Done</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-brand/20 inline-block" /> Remaining</span>
          <span className="flex items-center gap-1.5"><span className="w-0.5 h-3 bg-stone-800 dark:bg-neutral-200 inline-block" /> Pace</span>
        </div>
      </div>

      {/* Top-level metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <RingCard label="Sprint" value={`${sprintPct}%`} pct={sprintPct} color="#0E7C86" sub="elapsed" />
        <RingCard label="Points" value={`${totals.donePoints}/${totals.points}`} pct={pointsPct} color="#8b5cf6" sub={`${pointsPct}% done`} />
        <RingCard label="Tasks" value={`${totals.doneTasks}/${totals.tasks}`} pct={tasksPct} color="#3b82f6" sub={`${tasksPct}% done`} />
        <RingCard label="Features" value={`${shippedCount}/${sprintFeatures.length}`} pct={sprintFeatures.length > 0 ? Math.round((shippedCount / sprintFeatures.length) * 100) : 0} color="#10b981" sub="shipped" />
      </div>

      {/* Feature pipeline */}
      {featureStatusBreakdown.length > 0 && (
        <div className={card + " p-4"}>
          <h3 className="text-xs font-medium text-stone-400 dark:text-neutral-500 uppercase tracking-wider mb-3">Feature Pipeline</h3>
          <div className="h-8 rounded-lg overflow-hidden flex">
            {featureStatusBreakdown.map(({ status, count }) => (
              <div
                key={status}
                className={cn("h-full flex items-center justify-center gap-1 text-xs font-medium transition-all", STATUS_COLORS[status].bg, STATUS_COLORS[status].text)}
                style={{ width: `${(count / sprintFeatures.length) * 100}%` }}
                title={`${STATUS_COLORS[status].label}: ${count}`}
              >
                <span className={cn("w-2 h-2 rounded-full shrink-0", STATUS_COLORS[status].dot)} />
                {count}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {featureStatusBreakdown.map(({ status, count }) => (
              <span key={status} className="flex items-center gap-1.5 text-[10px] text-stone-500 dark:text-neutral-400">
                <span className={cn("w-2 h-2 rounded-full", STATUS_COLORS[status].dot)} />
                {STATUS_COLORS[status].label} {count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Workload per person */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium text-stone-400 dark:text-neutral-500 uppercase tracking-wider">Per Person</h3>
          {tasksLoading && (
            <span className="flex items-center gap-1.5 text-[10px] text-stone-400 dark:text-neutral-500">
              <Loader2 size={10} className="animate-spin" />
              Loading tasks...
            </span>
          )}
        </div>
        {engineers.map((eng, i) => {
          const pct = eng.totalPoints > 0 ? Math.round((eng.donePoints / eng.totalPoints) * 100) : 0;
          const taskDonePct = eng.totalTasks > 0 ? Math.round((eng.doneTasks / eng.totalTasks) * 100) : 0;
          const isExpanded = expandedPerson === eng.login;
          const color = PERSON_COLORS[i % PERSON_COLORS.length];
          const status = getPaceStatus(eng.donePoints, eng.totalPoints, elapsedPct);

          return (
            <div key={eng.login} className={card + " overflow-hidden"}>
              {/* Main row */}
              <button
                onClick={() => setExpandedPerson(isExpanded ? null : eng.login)}
                className="w-full flex items-center gap-3 p-4 text-left cursor-pointer hover:bg-stone-50 dark:hover:bg-white/[0.03] transition-colors"
              >
                {/* Avatar */}
                {eng.avatar_url ? (
                  <img src={eng.avatar_url} className="w-9 h-9 rounded-full shrink-0" alt="" />
                ) : (
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ backgroundColor: color }}>
                    {eng.name.slice(0, 2).toUpperCase()}
                  </div>
                )}

                {/* Name + team */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-stone-800 dark:text-neutral-200">{eng.name}</span>
                    {eng.team && <span className="text-[10px] text-stone-400 dark:text-neutral-500">{eng.team}</span>}
                    {eng.totalPoints > 0 && (
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", STATUS_BADGE_STYLES[status])}>
                        {status === "on-track" ? "On Track" : status === "at-risk" ? "At Risk" : "Behind"}
                      </span>
                    )}
                  </div>
                  {/* Features as compact list with status dots */}
                  {eng.features.length > 0 && (
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                      {eng.features.map((f) => (
                        <span key={f.id} className="flex items-center gap-1 text-[11px] text-stone-500 dark:text-neutral-400">
                          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", STATUS_COLORS[f.status].dot)} />
                          {f.title}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Stats */}
                <div className="hidden sm:flex items-center gap-3 shrink-0 text-xs">
                  {eng.totalTasks > 0 && (
                    <span className="text-stone-500 dark:text-neutral-400">
                      <span className="font-semibold text-stone-700 dark:text-neutral-200">{eng.doneTasks}</span>/{eng.totalTasks} tasks
                    </span>
                  )}
                  {eng.totalPoints > 0 && (
                    <span className="text-stone-500 dark:text-neutral-400">
                      <span className="font-semibold text-stone-700 dark:text-neutral-200">{eng.donePoints}</span>/{eng.totalPoints} pts
                    </span>
                  )}
                </div>

                {/* Chevron */}
                <div className="shrink-0 text-stone-400 dark:text-neutral-500">
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </div>
              </button>

              {/* Points progress bar */}
              {eng.totalPoints > 0 && (
                <div className="px-4 pb-3">
                  <div className="h-1.5 bg-stone-100 dark:bg-dark-overlay rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full transition-all duration-500" style={{ width: `${(eng.donePoints / eng.totalPoints) * 100}%` }} />
                  </div>
                </div>
              )}

              {/* Expanded: task list grouped by feature */}
              {isExpanded && (
                <div className="border-t border-stone-100 dark:border-white/[0.06] bg-stone-50/50 dark:bg-white/[0.02]">
                  {/* Stats on mobile */}
                  <div className="sm:hidden flex items-center gap-4 px-4 py-2 border-b border-stone-100 dark:border-white/[0.06]">
                    <span className="text-xs text-stone-500 dark:text-neutral-400">{eng.donePoints}/{eng.totalPoints} pts ({pct}%)</span>
                    <span className="text-xs text-stone-500 dark:text-neutral-400">{eng.doneTasks}/{eng.totalTasks} tasks ({taskDonePct}%)</span>
                  </div>

                  {eng.features.length > 0 ? (
                    (() => {
                      const tasksByFeature = new Map<number, SubIssueWithFeature[]>();
                      for (const t of eng.tasks) {
                        const arr = tasksByFeature.get(t.featureId) ?? [];
                        arr.push(t);
                        tasksByFeature.set(t.featureId, arr);
                      }
                      return eng.features.map((f) => {
                      const featureTasks = tasksByFeature.get(f.id) ?? [];
                      const done = featureTasks.filter((t) => t.state === "closed").length;
                      return (
                        <div key={f.id} className="px-4 py-3 border-b border-stone-100 dark:border-white/[0.06] last:border-b-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className={cn("w-2 h-2 rounded-full shrink-0", STATUS_COLORS[f.status].dot)} />
                            <span className="text-xs font-semibold text-stone-700 dark:text-neutral-300">{f.title}</span>
                            {featureTasks.length > 0 && (
                              <span className="text-[10px] text-stone-400 dark:text-neutral-500 ml-auto">{done}/{featureTasks.length}</span>
                            )}
                          </div>
                          {featureTasks.length > 0 && (
                            <div className="space-y-1 ml-4">
                              {featureTasks.map((t) => (
                                <div key={t.id} className="flex items-center gap-2">
                                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", t.state === "closed" ? "bg-green-500" : "bg-stone-300 dark:bg-neutral-600")} />
                                  <a href={t.html_url} target="_blank" rel="noopener noreferrer"
                                    className={cn("text-xs hover:text-brand flex-1", t.state === "closed" ? "line-through text-stone-400 dark:text-neutral-500" : "text-stone-600 dark:text-neutral-400")}>
                                    {t.title}
                                  </a>
                                  {t.points != null && (
                                    <span className="text-[10px] text-stone-400 dark:text-neutral-500 shrink-0">{t.points}pt</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          {featureTasks.length === 0 && (
                            <p className="text-[11px] text-stone-400 dark:text-neutral-500 ml-4">No tasks assigned</p>
                          )}
                        </div>
                      );
                    });
                    })()
                  ) : (
                    <div className="px-4 py-3">
                      <p className="text-xs text-stone-400 dark:text-neutral-500">No features assigned</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Ring metric card ---

function RingCard({ label, value, pct, color, sub }: { label: string; value: string; pct: number; color: string; sub: string }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(pct, 100) / 100) * c;

  return (
    <div className={card + " p-4 flex items-center gap-4"}>
      <div className="relative w-16 h-16 shrink-0">
        <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-stone-100 dark:text-white/[0.06]" />
          <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} className="transition-all duration-700" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-stone-700 dark:text-neutral-200">{pct}%</span>
      </div>
      <div>
        <span className="text-[10px] font-semibold text-stone-400 dark:text-neutral-500 uppercase tracking-wider block">{label}</span>
        <span className="text-lg font-bold text-stone-800 dark:text-neutral-200 block leading-tight">{value}</span>
        <span className="text-[10px] text-stone-400 dark:text-neutral-500">{sub}</span>
      </div>
    </div>
  );
}
