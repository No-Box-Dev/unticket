import { useMemo } from "react";
import { useOrgMembers } from "@/hooks/useGitHub";
import { useFeatures, useSprint, useAllSprintSubIssues, usePeople } from "@/hooks/useConfigRepo";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import type { FeatureStatus } from "@/lib/types";

const card = "bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-xl p-5";

const DONE_STATUSES: FeatureStatus[] = ["tested", "production"];

const STATUS_COLORS: Record<FeatureStatus, { bg: string; text: string; label: string }> = {
  plan: { bg: "bg-stone-200 dark:bg-neutral-700", text: "text-stone-600 dark:text-neutral-300", label: "Plan" },
  in_progress: { bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-700 dark:text-blue-300", label: "In Progress" },
  demo: { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-300", label: "Demo" },
  tested: { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300", label: "Tested" },
  production: { bg: "bg-green-100 dark:bg-green-900/40", text: "text-green-700 dark:text-green-300", label: "Production" },
  future: { bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-700 dark:text-purple-300", label: "Future" },
};

// Donut chart colors per person (cycle through)
const PERSON_COLORS = [
  "#8b5cf6", "#3b82f6", "#14b8a6", "#f59e0b", "#ef4444",
  "#ec4899", "#6366f1", "#06b6d4", "#84cc16", "#f97316",
];

interface EngineerWorkload {
  login: string;
  name: string;
  avatar_url: string | null;
  totalPoints: number;
  donePoints: number;
  totalTasks: number;
  doneTasks: number;
  totalRoles: number;
  doneRoles: number;
  totalFeatures: number;
  doneFeatures: number;
  features: { title: string; status: FeatureStatus }[];
}

export function WorkloadTab({ repoNames: _repoNames }: { repoNames: string[] }) {
  const { data: orgMembers, isLoading } = useOrgMembers();
  const { data: features } = useFeatures();
  const { data: sprint } = useSprint();
  const { data: people } = usePeople();

  const sprintFeatureIds = useMemo(() => {
    if (!features || !sprint) return [];
    return features.filter((f) => f.sprint === sprint.number).map((f) => f.id);
  }, [features, sprint]);
  const { data: allTasks } = useAllSprintSubIssues(sprintFeatureIds);

  const sprintFeatures = useMemo(() => {
    if (!features || !sprint) return [];
    return features.filter((f) => f.sprint === sprint.number);
  }, [features, sprint]);

  const engineers = useMemo((): EngineerWorkload[] => {
    if (!orgMembers) return [];

    const peopleMap = new Map((people ?? []).map((p) => [p.github, p]));

    // Tasks per person
    const tasksByPerson = new Map<string, { done: number; total: number; points: number; donePoints: number }>();
    for (const t of allTasks ?? []) {
      for (const a of t.assignees) {
        const entry = tasksByPerson.get(a) ?? { done: 0, total: 0, points: 0, donePoints: 0 };
        entry.total++;
        entry.points += t.points ?? 0;
        if (t.state === "closed") {
          entry.done++;
          entry.donePoints += t.points ?? 0;
        }
        tasksByPerson.set(a, entry);
      }
    }

    // Roles per person
    const rolesByPerson = new Map<string, { done: number; total: number }>();
    const roleGroups = new Map<number, { assignees: Set<string>; tasks: { state: string }[] }>();
    for (const t of allTasks ?? []) {
      if (!t.roleNumber) continue;
      const group = roleGroups.get(t.roleNumber) ?? { assignees: new Set(), tasks: [] };
      for (const a of t.assignees) group.assignees.add(a);
      group.tasks.push(t);
      roleGroups.set(t.roleNumber, group);
    }
    for (const group of roleGroups.values()) {
      const allClosed = group.tasks.every((t) => t.state === "closed");
      for (const login of group.assignees) {
        const entry = rolesByPerson.get(login) ?? { done: 0, total: 0 };
        entry.total++;
        if (allClosed) entry.done++;
        rolesByPerson.set(login, entry);
      }
    }

    // Features per person
    const featuresByPerson = new Map<string, { title: string; status: FeatureStatus }[]>();
    for (const f of sprintFeatures) {
      for (const o of f.owners) {
        if (!featuresByPerson.has(o)) featuresByPerson.set(o, []);
        featuresByPerson.get(o)!.push({ title: f.title, status: f.status });
      }
    }

    return orgMembers.map((m: any) => {
      const person = peopleMap.get(m.login);
      const tasks = tasksByPerson.get(m.login) ?? { done: 0, total: 0, points: 0, donePoints: 0 };
      const roles = rolesByPerson.get(m.login) ?? { done: 0, total: 0 };
      const personFeatures = featuresByPerson.get(m.login) ?? [];
      return {
        login: m.login,
        name: person?.name ?? m.login,
        avatar_url: m.avatar_url,
        totalPoints: tasks.points,
        donePoints: tasks.donePoints,
        totalTasks: tasks.total,
        doneTasks: tasks.done,
        totalRoles: roles.total,
        doneRoles: roles.done,
        totalFeatures: personFeatures.length,
        doneFeatures: personFeatures.filter((f) => DONE_STATUSES.includes(f.status)).length,
        features: personFeatures,
      };
    })
    .filter((e) => e.totalPoints > 0 || e.totalTasks > 0 || e.totalRoles > 0 || e.features.length > 0)
    .sort((a, b) => b.totalPoints - a.totalPoints);
  }, [orgMembers, people, allTasks, sprintFeatures]);

  // Team totals
  const totals = useMemo(() => {
    const t = { points: 0, donePoints: 0, tasks: 0, doneTasks: 0, roles: 0, doneRoles: 0, features: 0, doneFeatures: 0 };
    for (const e of engineers) {
      t.points += e.totalPoints;
      t.donePoints += e.donePoints;
      t.tasks += e.totalTasks;
      t.doneTasks += e.doneTasks;
      t.roles += e.totalRoles;
      t.doneRoles += e.doneRoles;
      t.features += e.totalFeatures;
      t.doneFeatures += e.doneFeatures;
    }
    return t;
  }, [engineers]);

  // Feature status breakdown
  const featureStatusBreakdown = useMemo(() => {
    const counts = new Map<FeatureStatus, number>();
    for (const f of sprintFeatures) {
      counts.set(f.status, (counts.get(f.status) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  }, [sprintFeatures]);

  // Max values for bar scaling
  const maxPoints = useMemo(() => Math.max(...engineers.map((e) => e.totalPoints), 1), [engineers]);
  const maxTasks = useMemo(() => Math.max(...engineers.map((e) => e.totalTasks), 1), [engineers]);
  const maxRoles = useMemo(() => Math.max(...engineers.map((e) => e.totalRoles), 1), [engineers]);
  const maxFeatures = useMemo(() => Math.max(...engineers.map((e) => e.totalFeatures), 1), [engineers]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-800 dark:text-neutral-200 font-display">
          Sprint Workload {sprint ? `— ${sprint.name}` : ""}
        </h2>
        <div className="flex items-center gap-4 text-xs text-stone-400 dark:text-neutral-500">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-purple-500 inline-block" /> Points</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-500 inline-block" /> Tasks</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-teal-500 inline-block" /> Roles</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-brand inline-block" /> Features</span>
        </div>
      </div>

      {/* Team-level summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label="Points" done={totals.donePoints} total={totals.points} color="text-purple-500" />
        <SummaryCard label="Tasks" done={totals.doneTasks} total={totals.tasks} color="text-blue-500" />
        <SummaryCard label="Roles" done={totals.doneRoles} total={totals.roles} color="text-teal-500" />
        <SummaryCard label="Features" done={totals.doneFeatures} total={totals.features} color="text-brand" />
      </div>

      {/* Distribution charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Points distribution */}
        <div className={card}>
          <h3 className="text-xs font-medium text-stone-400 dark:text-neutral-500 uppercase tracking-wider mb-3">
            Points Distribution
          </h3>
          <div className="space-y-2">
            {engineers.filter((e) => e.totalPoints > 0).map((eng, i) => (
              <div key={eng.login} className="flex items-center gap-2">
                <span className="text-xs text-stone-600 dark:text-neutral-400 w-24 truncate shrink-0">{eng.name}</span>
                <div className="flex-1 h-5 bg-stone-100 dark:bg-dark-overlay rounded overflow-hidden relative">
                  <div
                    className="h-full rounded absolute left-0 top-0 opacity-30"
                    style={{ width: `${(eng.totalPoints / maxPoints) * 100}%`, backgroundColor: PERSON_COLORS[i % PERSON_COLORS.length] }}
                  />
                  <div
                    className="h-full rounded absolute left-0 top-0"
                    style={{ width: `${(eng.donePoints / maxPoints) * 100}%`, backgroundColor: PERSON_COLORS[i % PERSON_COLORS.length] }}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-medium text-stone-500 dark:text-neutral-400">
                    {eng.donePoints}/{eng.totalPoints}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Feature status breakdown */}
        <div className={card}>
          <h3 className="text-xs font-medium text-stone-400 dark:text-neutral-500 uppercase tracking-wider mb-3">
            Features by Status
          </h3>
          {featureStatusBreakdown.length === 0 ? (
            <p className="text-sm text-stone-400 dark:text-neutral-500">No features this sprint.</p>
          ) : (
            <>
              {/* Stacked bar */}
              <div className="h-6 rounded overflow-hidden flex mb-4">
                {featureStatusBreakdown.map(({ status, count }) => (
                  <div
                    key={status}
                    className={cn("h-full flex items-center justify-center text-[10px] font-medium", STATUS_COLORS[status].bg, STATUS_COLORS[status].text)}
                    style={{ width: `${(count / sprintFeatures.length) * 100}%` }}
                    title={`${STATUS_COLORS[status].label}: ${count}`}
                  >
                    {count}
                  </div>
                ))}
              </div>
              {/* Legend */}
              <div className="flex flex-wrap gap-3">
                {featureStatusBreakdown.map(({ status, count }) => (
                  <div key={status} className="flex items-center gap-1.5">
                    <span className={cn("w-2.5 h-2.5 rounded-sm", STATUS_COLORS[status].bg)} />
                    <span className="text-xs text-stone-500 dark:text-neutral-400">{STATUS_COLORS[status].label}</span>
                    <span className="text-xs font-semibold text-stone-700 dark:text-neutral-200">{count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Per-engineer cards */}
      <div className="space-y-3">
        {engineers.map((eng) => (
          <div key={eng.login} className={card}>
            <div className="flex items-center gap-3 mb-3">
              {eng.avatar_url ? (
                <img src={eng.avatar_url} className="w-8 h-8 rounded-full shrink-0" alt="" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-stone-200 dark:bg-dark-overlay flex items-center justify-center text-xs font-bold text-stone-500 shrink-0">
                  {eng.name[0]?.toUpperCase() ?? "?"}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-stone-800 dark:text-neutral-200 block truncate">{eng.name}</span>
                {eng.features.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {eng.features.map((f) => (
                      <span
                        key={f.title}
                        className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", STATUS_COLORS[f.status].bg, STATUS_COLORS[f.status].text)}
                      >
                        {f.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Stat label="Pts" done={eng.donePoints} total={eng.totalPoints} />
                <Stat label="Tasks" done={eng.doneTasks} total={eng.totalTasks} />
                <Stat label="Roles" done={eng.doneRoles} total={eng.totalRoles} />
                <Stat label="Feat" done={eng.doneFeatures} total={eng.totalFeatures} />
              </div>
            </div>

            {/* Workload bars */}
            <div className="space-y-1.5">
              <WorkloadBar
                label="Points"
                done={eng.donePoints}
                total={eng.totalPoints}
                max={maxPoints}
                color="bg-purple-500"
              />
              <WorkloadBar
                label="Tasks"
                done={eng.doneTasks}
                total={eng.totalTasks}
                max={maxTasks}
                color="bg-blue-500"
              />
              <WorkloadBar
                label="Roles"
                done={eng.doneRoles}
                total={eng.totalRoles}
                max={maxRoles}
                color="bg-teal-500"
              />
              <WorkloadBar
                label="Features"
                done={eng.doneFeatures}
                total={eng.totalFeatures}
                max={maxFeatures}
                color="bg-brand"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkloadBar({
  label,
  done,
  total,
  max,
  color,
}: {
  label: string;
  done: number;
  total: number;
  max: number;
  color: string;
}) {
  if (total === 0) return null;
  const totalPct = (total / max) * 100;
  const donePct = total > 0 ? (done / total) * 100 : 0;

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-stone-400 dark:text-neutral-500 w-12 shrink-0">{label}</span>
      <div className="flex-1 h-4 bg-stone-100 dark:bg-dark-overlay rounded overflow-hidden relative">
        <div
          className={cn("h-full rounded transition-all duration-500 absolute left-0 top-0", color, "opacity-30")}
          style={{ width: `${totalPct}%` }}
        />
        <div
          className={cn("h-full rounded transition-all duration-500 absolute left-0 top-0", color)}
          style={{ width: `${totalPct * (donePct / 100)}%` }}
        />
      </div>
    </div>
  );
}

function Stat({ label, done, total }: { label: string; done: number; total: number }) {
  if (total === 0) return null;
  return (
    <div className="text-center">
      <span className="text-xs font-semibold text-stone-700 dark:text-neutral-200 block">{done}/{total}</span>
      <span className="text-[9px] text-stone-400 dark:text-neutral-500 uppercase">{label}</span>
    </div>
  );
}

function SummaryCard({ label, done, total, color }: { label: string; done: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className={card}>
      <div className="text-xs font-medium text-stone-400 dark:text-neutral-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className={cn("text-2xl font-semibold", color)}>{done}</span>
        <span className="text-sm text-stone-400 dark:text-neutral-500">/ {total}</span>
        {total > 0 && (
          <span className="text-xs text-stone-400 dark:text-neutral-500 ml-auto">{pct}%</span>
        )}
      </div>
      <div className="h-1.5 bg-stone-100 dark:bg-dark-overlay rounded-full mt-2 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", color.replace("text-", "bg-"))}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
