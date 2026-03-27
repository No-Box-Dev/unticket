import { useMemo } from "react";
import { Spinner } from "@/components/Spinner";
import type { Feature, Person, SprintConfig } from "@/lib/types";
import type { SubIssueWithFeature } from "@/hooks/useConfigRepo";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  open: { label: "Open", color: "#0E7C86" },
  closed: { label: "Closed", color: "#22C55E" },
};

const AVATAR_COLORS = [
  "#EF4444", "#F97316", "#3B82F6", "#22C55E", "#A855F7",
  "#EC4899", "#06B6D4", "#EAB308", "#6366F1", "#14B8A6",
];

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  return name.split(/[\s-]+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

const card = "bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-xl p-5";

interface SprintMetricsProps {
  sprint: SprintConfig;
  sprintFeatures: Feature[];
  people: Person[] | undefined;
  allTasks: SubIssueWithFeature[] | undefined;
  tasksLoading: boolean;
}

export function SprintMetrics({ sprint, sprintFeatures, people, allTasks, tasksLoading }: SprintMetricsProps) {
  const featureMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const f of sprintFeatures) m.set(f.id, f.title);
    return m;
  }, [sprintFeatures]);

  const peopleMap = useMemo(() => {
    const m = new Map<string, Person>();
    if (people) for (const p of people) m.set(p.github, p);
    return m;
  }, [people]);

  const tasks = useMemo(() => {
    if (!allTasks) return [];
    return allTasks.map((t) => ({ ...t, featureTitle: featureMap.get(t.featureId) ?? `Feature #${t.featureId}` }));
  }, [allTasks, featureMap]);

  const taskStats = useMemo(() => {
    const total = tasks.length;
    const open = tasks.filter((t) => t.state === "open").length;
    const closed = tasks.filter((t) => t.state === "closed").length;
    const now = new Date();
    const endDate = sprint?.endDate ? new Date(sprint.endDate + "T23:59:59") : null;
    const overdue = endDate && now > endDate ? open : 0;
    const completionPct = total > 0 ? Math.round((closed / total) * 100) : 0;
    const totalPoints = tasks.reduce((sum, t) => sum + (t.points ?? 0), 0);
    const donePoints = tasks.filter((t) => t.state === "closed").reduce((sum, t) => sum + (t.points ?? 0), 0);
    return { total, open, closed, overdue, completionPct, totalPoints, donePoints };
  }, [tasks, sprint]);

  const featureStats = useMemo(() => {
    const total = sprintFeatures.length;
    const completed = sprintFeatures.filter((f) => f.status === "production").length;
    const inProgress = sprintFeatures.filter((f) => f.status === "in_progress" || f.status === "demo" || f.status === "tested").length;
    return { total, completed, inProgress };
  }, [sprintFeatures]);

  const tasksByFeature = useMemo(() => {
    const m = new Map<number, { title: string; open: number; closed: number }>();
    for (const f of sprintFeatures) m.set(f.id, { title: f.title, open: 0, closed: 0 });
    for (const t of tasks) {
      const entry = m.get(t.featureId);
      if (entry) { if (t.state === "closed") entry.closed++; else entry.open++; }
    }
    return Array.from(m.entries())
      .map(([id, data]) => ({ id, ...data, total: data.open + data.closed }))
      .filter((f) => f.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [sprintFeatures, tasks]);

  const tasksByAssignee = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tasks) {
      if (t.state === "closed") continue;
      for (const a of t.assignees) counts.set(a, (counts.get(a) || 0) + 1);
      if (t.assignees.length === 0) counts.set("unassigned", (counts.get("unassigned") || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [tasks]);

  const aiSummary = useMemo(() => {
    if (!sprintFeatures.length) return null;
    const parts: string[] = [];
    if (featureStats.completed > 0) parts.push(`${featureStats.completed} of ${featureStats.total} features complete`);
    if (featureStats.inProgress > 0) parts.push(`${featureStats.inProgress} in progress`);
    if (taskStats.total > 0) {
      parts.push(`${taskStats.closed} of ${taskStats.total} tasks done (${taskStats.completionPct}%)`);
      if (taskStats.overdue > 0) parts.push(`${taskStats.overdue} tasks overdue`);
    }
    const closedByAssignee = new Map<string, number>();
    for (const t of tasks) {
      if (t.state === "closed") { for (const a of t.assignees) closedByAssignee.set(a, (closedByAssignee.get(a) || 0) + 1); }
    }
    if (closedByAssignee.size > 0) {
      const [top, count] = Array.from(closedByAssignee.entries()).sort((a, b) => b[1] - a[1])[0];
      const name = peopleMap.get(top)?.name ?? top;
      parts.push(`${name} leads with ${count} task${count > 1 ? "s" : ""} completed`);
    }
    return parts.length > 0 ? parts.join(". ") + "." : null;
  }, [sprintFeatures, featureStats, taskStats, tasks, peopleMap]);

  const maxAssignee = tasksByAssignee.length > 0 ? tasksByAssignee[0][1] : 1;

  return (
    <div className="space-y-4">
      {aiSummary && (
        <div className="bg-gradient-to-r from-stone-800 to-stone-700 dark:from-stone-900 dark:to-dark-overlay rounded-xl p-5 text-white">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">AI</div>
            <h3 className="font-semibold font-display text-sm">Sprint Summary</h3>
          </div>
          <p className="text-sm text-stone-300 leading-relaxed">{aiSummary}</p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <StatCard label="FEATURES" value={featureStats.total} subtitle={`${featureStats.completed} complete`} color="text-stone-700 dark:text-neutral-200" />
        <StatCard label="OPEN TASKS" value={taskStats.open} subtitle={`of ${taskStats.total} total`} color="text-blue-500" />
        <StatCard label="OVERDUE" value={taskStats.overdue} subtitle={taskStats.overdue === 0 ? "on schedule" : "past sprint end"} color={taskStats.overdue > 0 ? "text-red-500" : "text-stone-300 dark:text-neutral-600"} />
        <StatCard label="TASKS DONE" value={taskStats.closed} subtitle={`${taskStats.completionPct}%`} color="text-green-500" />
        <StatCard label="POINTS" value={taskStats.donePoints} subtitle={`of ${taskStats.totalPoints} total`} color="text-purple-500" />
      </div>

      <div className={card}>
        <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-4">Task Progress</h3>
        {taskStats.total > 0 ? (
          <>
            <div className="flex h-5 rounded-full overflow-hidden bg-stone-100 dark:bg-dark-overlay">
              {taskStats.closed > 0 && <div className="transition-all duration-500" style={{ width: `${(taskStats.closed / taskStats.total) * 100}%`, backgroundColor: STATUS_CONFIG.closed.color }} />}
              {taskStats.open > 0 && <div className="transition-all duration-500" style={{ width: `${(taskStats.open / taskStats.total) * 100}%`, backgroundColor: STATUS_CONFIG.open.color }} />}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3">
              <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-neutral-400">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_CONFIG.closed.color }} /> Done {taskStats.closed}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-neutral-400">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_CONFIG.open.color }} /> Open {taskStats.open}
              </div>
            </div>
          </>
        ) : tasksLoading ? (
          <div className="flex items-center gap-2 text-sm text-stone-400"><Spinner size="sm" /> Loading tasks...</div>
        ) : (
          <p className="text-sm text-stone-400">No tasks found. Add sub-issues to your features.</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={card}>
          <h3 className="font-semibold text-stone-900 dark:text-neutral-100 mb-6">Tasks by State</h3>
          {taskStats.total > 0 ? (
            <DonutChart segments={[
              { value: taskStats.open, color: STATUS_CONFIG.open.color, label: "Open" },
              { value: taskStats.closed, color: STATUS_CONFIG.closed.color, label: "Done" },
            ].filter((s) => s.value > 0)} />
          ) : (
            <p className="text-sm text-stone-400 text-center py-10">No tasks</p>
          )}
        </div>

        <div className={card}>
          <h3 className="font-semibold text-stone-900 dark:text-neutral-100 mb-4">Tasks per Feature</h3>
          {tasksByFeature.length > 0 ? (
            <div className="space-y-2.5 max-h-52 overflow-y-auto">
              {tasksByFeature.map((f) => {
                const maxCount = tasksByFeature[0].total;
                return (
                  <div key={f.id}>
                    <div className="flex justify-between text-xs text-stone-500 dark:text-neutral-400 mb-1">
                      <span className="truncate max-w-[180px]">{f.title}</span>
                      <span className="tabular-nums shrink-0">{f.closed}/{f.total}</span>
                    </div>
                    <div className="h-3 bg-stone-100 dark:bg-dark-overlay rounded-full overflow-hidden flex">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(f.closed / maxCount) * 100}%`, backgroundColor: STATUS_CONFIG.closed.color }} />
                      <div className="h-full transition-all duration-500" style={{ width: `${(f.open / maxCount) * 100}%`, backgroundColor: STATUS_CONFIG.open.color, opacity: 0.4 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-stone-400 text-center py-10">No data</p>
          )}
        </div>

        <div className={card}>
          <h3 className="font-semibold text-stone-900 dark:text-neutral-100 mb-4">Open Tasks by Assignee</h3>
          {tasksByAssignee.length > 0 ? (
            <div className="space-y-3">
              {tasksByAssignee.map(([assignee, count]) => {
                const person = peopleMap.get(assignee);
                const displayName = assignee === "unassigned" ? "Unassigned" : (person?.name ?? assignee);
                const initials = assignee === "unassigned" ? "?" : getInitials(displayName);
                const color = hashColor(assignee);
                const widthPct = (count / maxAssignee) * 100;
                return (
                  <div key={assignee} className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ backgroundColor: assignee === "unassigned" ? "#A8A29E" : color }}>{initials}</div>
                    <span className="text-sm text-stone-700 dark:text-neutral-300 w-24 truncate shrink-0">{displayName}</span>
                    <div className="flex-1 h-3 bg-stone-100 dark:bg-dark-overlay rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${widthPct}%`, backgroundColor: color }} />
                    </div>
                    <span className="text-sm text-stone-500 dark:text-neutral-400 font-medium tabular-nums w-5 text-right shrink-0">{count}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-stone-400 text-center py-10">No open tasks</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, subtitle, color }: { label: string; value: number; subtitle: string; color: string }) {
  return (
    <div className={card + " flex flex-col justify-center"}>
      <span className="text-xs font-semibold text-stone-400 uppercase tracking-wider">{label}</span>
      <span className={`text-4xl font-bold font-display mt-1 ${color}`}>{value}</span>
      <span className="text-sm text-stone-400 mt-1">{subtitle}</span>
    </div>
  );
}

function DonutChart({ segments }: { segments: { value: number; color: string; label: string }[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const size = 160;
  const stroke = 32;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  // Precompute offsets in a single O(n) pass
  let runningOffset = 0;
  const segmentData = segments.map((seg) => {
    const dashLen = (seg.value / total) * circumference;
    const startOffset = runningOffset;
    runningOffset += dashLen;
    return { seg, dashLen, gap: circumference - dashLen, startOffset };
  });

  return (
    <div className="flex flex-col items-center gap-4">
      <svg width={size} height={size} className="transform -rotate-90">
        {segmentData.map(({ seg, dashLen, gap, startOffset }) => (
            <circle key={seg.label} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={seg.color} strokeWidth={stroke} strokeDasharray={`${dashLen} ${gap}`} strokeDashoffset={-startOffset} className="transition-all duration-500" />
        ))}
      </svg>
      <div className="flex flex-wrap justify-center gap-3">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-neutral-400">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: seg.color }} />
            {seg.label} {seg.value}
          </div>
        ))}
      </div>
    </div>
  );
}
