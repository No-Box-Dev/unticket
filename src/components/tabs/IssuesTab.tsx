/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo, useCallback } from "react";
import { usePaginatedIssues, useIssueLabels, useRepos, useActiveMembers, useUpdateIssueAssignees, useIssueStats } from "@/hooks/useGitHub";
import { useSprint, useSettings } from "@/hooks/useConfigRepo";
import { CircleDot, CircleCheck, ExternalLink, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, RefreshCw, Check, X, Loader2, AlertCircle, Clock, UserX, Flag } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { PersonSelect } from "@/components/ui/PersonSelect";
import { AssignDropdown } from "@/components/sprint/AssignDropdown";
import { useQueryClient } from "@tanstack/react-query";
import { triggerSyncWithProgress, type SyncProgress } from "@/lib/github";

function daysAgo(date: string): number {
  return Math.floor(
    (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24),
  );
}

type SortKey = "number" | "title" | "repo" | "updated_at" | "created_at";

const EXCLUDED_REPOS = new Set(["gitpulse", ".gitpulse"]);
const CRITICAL_LABELS = new Set(["critical"]);

function isCritical(issue: any): boolean {
  return (issue.labels ?? []).some((l: any) => CRITICAL_LABELS.has(l.name?.toLowerCase()));
}

function SortIcon({ column, activeSortKey, activeSortDirection }: { column: SortKey; activeSortKey: SortKey; activeSortDirection: "asc" | "desc" }) {
  if (activeSortKey !== column) return null;
  return activeSortDirection === "asc" ? (
    <ChevronUp className="w-3 h-3 inline ml-0.5" />
  ) : (
    <ChevronDown className="w-3 h-3 inline ml-0.5" />
  );
}

const labelColors: Record<string, { bg: string; text: string }> = {
  bug: { bg: "bg-red-50 dark:bg-red-500/10", text: "text-red-700 dark:text-red-400" },
  enhancement: { bg: "bg-blue-50 dark:bg-blue-500/10", text: "text-blue-700 dark:text-blue-400" },
  feature: { bg: "bg-blue-50 dark:bg-blue-500/10", text: "text-blue-700 dark:text-blue-400" },
  investigation: { bg: "bg-yellow-50 dark:bg-yellow-500/10", text: "text-yellow-700 dark:text-yellow-400" },
  documentation: { bg: "bg-accent-light dark:bg-accent/10", text: "text-accent" },
};

function getLabelStyle(name: string, color: string) {
  const key = name.toLowerCase();
  for (const [keyword, style] of Object.entries(labelColors)) {
    if (key.includes(keyword)) return style;
  }
  return {
    bg: `bg-[#${color}20]` as string,
    text: `text-[#${color}]` as string,
  };
}

const PAGE_SIZE = 30;

const card = "bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-xl";

interface IssuesTabProps {
  repoNames: string[];
  navFilter?: import("@/lib/types").NavFilter | null;
}

export function IssuesTab({ navFilter }: IssuesTabProps) {
  const qc = useQueryClient();
  const { data: sprint, isLoading: sprintLoading } = useSprint();
  const { data: settings } = useSettings();
  const { data: labels } = useIssueLabels();
  const { data: repos } = useRepos();
  const { data: members } = useActiveMembers();
  const updateAssignees = useUpdateIssueAssignees();

  const memberLogins = useMemo(() => members?.map((m) => m.login).sort() ?? [], [members]);

  const draftRepos = useMemo(() => new Set(settings?.draftRepos ?? []), [settings]);

  const repoList = useMemo(() => {
    return repos?.map((r: any) => r.name)
      .filter((n: string) => !EXCLUDED_REPOS.has(n) && !draftRepos.has(n))
      .sort() ?? [];
  }, [repos, draftRepos]);

  const [repoFilter, setRepoFilter] = useState<string>("all");
  const [assignmentFilter, setAssignmentFilter] = useState<"all" | "unassigned" | "assigned">(navFilter?.person ? "all" : "unassigned");
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>(navFilter?.person ? [navFilter.person] : []);
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [criticalRepoFilter, setCriticalRepoFilter] = useState<string>("all");
  const [criticalSort, setCriticalSort] = useState<{ key: "repo" | "age"; dir: "asc" | "desc" }>({ key: "age", dir: "asc" });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [openPage, setOpenPage] = useState(1);
  const [closedPage, setClosedPage] = useState(1);

  // Resolve repo filter → repo names
  const filteredRepos = useMemo(() => {
    if (repoFilter !== "all") {
      return [repoFilter];
    }
    return repoList.length > 0 ? repoList : undefined;
  }, [repoFilter, repoList]);

  // Stats for dashboard cards + charts (reactive to repo filter)
  const { data: stats } = useIssueStats(
    sprint?.startDate,
    filteredRepos,
  );

  // Issues closed on selected day (for chart drill-down)
  const nextDay = selectedDay ? new Date(new Date(selectedDay + "T00:00:00").getTime() + 86400000).toISOString().slice(0, 10) : undefined;
  const { data: dayDetail } = usePaginatedIssues({
    state: "closed",
    page: 1,
    pageSize: 100,
    closedSince: selectedDay ?? undefined,
    closedBefore: nextDay,
    repos: filteredRepos,
    sort: "updated_at",
    sortDir: "desc",
  }, !!selectedDay);

  // Critical issues query (all open, unfiltered by repo/assignee)
  const { data: criticalData } = usePaginatedIssues({
    state: "open",
    page: 1,
    pageSize: 50,
    label: "critical",
    sort: "created_at",
    sortDir: "desc",
  });

  // Open issues query
  const {
    data: openData,
    isLoading: openLoading,
    isFetching: openFetching,
  } = usePaginatedIssues({
    state: "open",
    page: openPage,
    pageSize: PAGE_SIZE,
    repos: filteredRepos,
    assignee: assigneeFilter.length === 1 ? assigneeFilter[0] : undefined,
    assigned: assignmentFilter === "unassigned" ? "false" : assignmentFilter === "assigned" ? "true" : undefined,
    label: labelFilter !== "all" ? labelFilter : undefined,
    sort: sortKey,
    sortDir,
  });

  // Closed issues query (since sprint start)
  const {
    data: closedData,
    isLoading: closedLoading,
    isFetching: closedFetching,
  } = usePaginatedIssues({
    state: "closed",
    page: closedPage,
    pageSize: PAGE_SIZE,
    repos: filteredRepos,
    assignee: assigneeFilter.length === 1 ? assigneeFilter[0] : undefined,
    assigned: assignmentFilter === "unassigned" ? "false" : assignmentFilter === "assigned" ? "true" : undefined,
    label: labelFilter !== "all" ? labelFilter : undefined,
    sort: sortKey,
    sortDir,
    closedSince: sprint?.startDate,
  }, !!sprint?.startDate);

  const resetPages = () => {
    setOpenPage(1);
    setClosedPage(1);
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    resetPages();
  };

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncedRepos, setSyncedRepos] = useState<string[]>([]);

  const startSync = useCallback(async () => {
    setSyncModalOpen(true);
    setSyncProgress(null);
    setSyncedRepos([]);
    let lastSyncingRepo: string | null = null;

    await triggerSyncWithProgress((status) => {
      setSyncProgress(status);
      if (status.phase === "syncing" && status.repo) {
        if (lastSyncingRepo) {
          setSyncedRepos((prev) =>
            prev.includes(lastSyncingRepo!) ? prev : [...prev, lastSyncingRepo!],
          );
        }
        lastSyncingRepo = status.repo;
      }
      if (status.phase === "done") {
        if (lastSyncingRepo) {
          setSyncedRepos((prev) =>
            prev.includes(lastSyncingRepo!) ? prev : [...prev, lastSyncingRepo!],
          );
        }
        qc.invalidateQueries({ queryKey: ["issues"] });
        qc.invalidateQueries({ queryKey: ["repos"] });
        qc.invalidateQueries({ queryKey: ["labels"] });
      }
    }, true /* force full re-sync to pick up label changes */);
  }, [qc]);

  const labelList = useMemo(() => {
    return labels?.map((l) => l.name).sort() ?? [];
  }, [labels]);

  const openTotal = openData?.totalCount ?? 0;
  const closedTotal = closedData?.totalCount ?? 0;
  const openPages = Math.ceil(openTotal / PAGE_SIZE);
  const closedPages = Math.ceil(closedTotal / PAGE_SIZE);

  const isLoading = openLoading || closedLoading || sprintLoading;

  const syncDone = syncProgress?.phase === "done";
  const syncError = syncProgress?.phase === "error";

  // Compute max for repo bar chart
  const repoMax = useMemo(() => {
    if (!stats?.byRepo?.length) return 1;
    return Math.max(...stats.byRepo.map((r) => r.count), 1);
  }, [stats?.byRepo]);

  return (
    <div className="space-y-6">
      {/* Sync Modal */}
      {syncModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div role="dialog" aria-modal="true" className="bg-white dark:bg-dark-raised rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 dark:border-white/[0.06]">
              <h3 className="text-sm font-semibold text-stone-800 dark:text-neutral-200">
                {syncDone ? "Sync Complete" : syncError ? "Sync Failed" : "Syncing from GitHub"}
              </h3>
              {(syncDone || syncError) && (
                <button
                  onClick={() => setSyncModalOpen(false)}
                  className="text-stone-400 dark:text-neutral-500 hover:text-stone-600 dark:hover:text-neutral-400 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="px-5 py-4 space-y-3">
              {syncProgress && syncProgress.total > 0 && (
                <div>
                  <div className="flex justify-between text-xs text-stone-500 dark:text-neutral-400 mb-1">
                    <span>{syncDone ? "All repos synced" : `Syncing repo ${Math.min(syncedRepos.length + 1, syncProgress.total)} of ${syncProgress.total}`}</span>
                    <span>{Math.round(((syncDone ? syncProgress.total : syncedRepos.length) / syncProgress.total) * 100)}%</span>
                  </div>
                  <div className="h-2 bg-stone-100 dark:bg-dark-overlay rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        syncError ? "bg-red-500" : "bg-brand",
                      )}
                      style={{
                        width: `${((syncDone ? syncProgress.total : syncedRepos.length) / syncProgress.total) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}
              {syncProgress?.phase === "init" && (
                <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-neutral-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Initializing sync...
                </div>
              )}
              {syncError && (
                <div className="flex items-center gap-2 text-xs text-red-600">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {syncProgress.error}
                </div>
              )}
              {syncProgress?.phase === "syncing" && syncProgress.repo && (
                <div className="flex items-center gap-2 text-xs text-stone-600 dark:text-neutral-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-brand" />
                  <span className="font-medium">{syncProgress.repo}</span>
                </div>
              )}
              {syncedRepos.length > 0 && (
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {syncedRepos.map((repo) => (
                    <div key={repo} className="flex items-center gap-2 text-xs text-stone-500 dark:text-neutral-400">
                      <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      {repo}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {(syncDone || syncError) && (
              <div className="px-5 py-3 border-t border-stone-100 dark:border-white/[0.06]">
                <button
                  onClick={() => setSyncModalOpen(false)}
                  className="w-full px-4 py-2 text-xs font-medium text-white bg-brand rounded-lg hover:bg-brand/90 cursor-pointer"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ──── Dashboard Header ──── */}
      <div className="flex items-center justify-end">
        <button
          onClick={startSync}
          disabled={syncModalOpen}
          className={cn(
            "flex items-center gap-1.5 text-xs text-stone-500 dark:text-neutral-400 hover:text-brand cursor-pointer",
            syncModalOpen && "opacity-50 cursor-not-allowed",
          )}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", (openFetching || closedFetching) && "animate-spin")} />
          Sync from GitHub
        </button>
      </div>

      {/* ──── Dashboard Stats ──── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Open Issues"
          value={stats?.open ?? 0}
          icon={<CircleDot className="w-4 h-4 text-green-600" />}
          loading={!stats}
        />
        <StatCard
          label="Unassigned"
          value={stats?.unassigned ?? 0}
          icon={<UserX className="w-4 h-4 text-amber-500" />}
          accent={stats && stats.unassigned > 0 ? "amber" : undefined}
          loading={!stats}
        />
        <StatCard
          label="Stale (>30d)"
          value={stats?.stale ?? 0}
          icon={<Clock className="w-4 h-4 text-red-500" />}
          accent={stats && stats.stale > 0 ? "red" : undefined}
          loading={!stats}
        />
        <StatCard
          label="Closed This Sprint"
          value={stats?.closedSprint ?? 0}
          icon={<CircleCheck className="w-4 h-4 text-brand" />}
          accent="brand"
          loading={!stats}
        />
      </div>

      {/* ──── Charts Row ──── */}
      <div className="grid grid-cols-1 gap-4">
        {/* Issues by Repo */}
        <div className={cn(card, "p-5")}>
          <h3 className="text-xs font-medium text-stone-500 dark:text-neutral-400 uppercase tracking-wider mb-4">Open Issues by Repo</h3>
          {!stats?.byRepo?.length ? (
            <p className="text-xs text-stone-400 dark:text-neutral-500">No data</p>
          ) : (
            <div className="space-y-2">
              {stats.byRepo.map((r) => {
                const criticalPct = r.critical > 0 ? (r.critical / repoMax) * 100 : 0;
                const normalPct = ((r.count - r.critical) / repoMax) * 100;
                return (
                  <div key={r.repo} className="flex items-center gap-3">
                    <span className="text-xs text-stone-600 dark:text-neutral-300 w-28 truncate shrink-0" title={r.repo}>{r.repo}</span>
                    <div className="flex-1 h-5 bg-stone-100 dark:bg-dark-overlay rounded overflow-hidden flex">
                      {r.critical > 0 && (
                        <div
                          className="h-full bg-red-500 transition-all duration-300"
                          style={{ width: `${criticalPct}%` }}
                        />
                      )}
                      <div
                        className="h-full bg-brand/70 transition-all duration-300"
                        style={{ width: `${normalPct}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs font-medium text-stone-700 dark:text-neutral-200 w-8 text-right tabular-nums">{r.count}</span>
                      {r.critical > 0 && (
                        <span className="flex items-center gap-0.5 text-red-500">
                          <Flag className="w-3 h-3" />
                          <span className="text-[10px] font-semibold tabular-nums">{r.critical}</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {/* ──── Resolution Trend ──── */}
      {stats?.closedPerDay && stats.closedPerDay.length > 0 && (
        <div className={cn(card, "p-5")}>
          <h3 className="text-xs font-medium text-stone-500 dark:text-neutral-400 uppercase tracking-wider mb-4">Issues Closed Per Day</h3>
          <DailyBarChart
            data={stats.closedPerDay}
            selectedDay={selectedDay}
            onSelectDay={(day) => setSelectedDay(selectedDay === day ? null : day)}
          />
          {selectedDay && dayDetail && (
            <div className="mt-4 border-t border-stone-100 dark:border-white/[0.06] pt-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-semibold text-stone-700 dark:text-neutral-200">
                  {new Date(selectedDay + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} — {dayDetail.totalCount} issue{dayDetail.totalCount !== 1 ? "s" : ""} closed
                </h4>
                <button onClick={() => setSelectedDay(null)} className="text-xs text-stone-400 hover:text-stone-600 dark:hover:text-neutral-300 cursor-pointer">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="space-y-1.5">
                {(dayDetail.data ?? []).map((issue: any) => {
                  const critical = isCritical(issue);
                  return (
                    <div key={issue.id} className={cn("flex items-center gap-3 text-xs py-1 px-2 rounded", critical && "bg-red-50/50 dark:bg-red-500/[0.04]")}>
                      {critical ? <Flag className="w-3.5 h-3.5 text-red-500 shrink-0" /> : <CircleCheck className="w-3.5 h-3.5 text-accent shrink-0" />}
                      <span className="text-stone-400 dark:text-neutral-500 shrink-0">#{issue.number}</span>
                      <a href={issue.html_url} target="_blank" rel="noopener noreferrer" className="text-stone-800 dark:text-neutral-200 hover:text-brand truncate">{issue.title}</a>
                      <span className="text-stone-400 dark:text-neutral-500 shrink-0 ml-auto">{issue.repo}</span>
                      <span className="text-stone-400 dark:text-neutral-500 shrink-0 w-20 text-right">{issue.closed_by ?? "—"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ──── Critical Issues ──── */}
      {(criticalData?.data ?? []).length > 0 && (() => {
        const criticalIssues = criticalData!.data as any[];
        const repoCountMap = new Map<string, number>();
        for (const issue of criticalIssues) {
          repoCountMap.set(issue.repo, (repoCountMap.get(issue.repo) ?? 0) + 1);
        }
        const repoOptions = [...repoCountMap.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([repo, count]) => ({ repo, count }));
        const filtered = criticalRepoFilter === "all"
          ? criticalIssues
          : criticalIssues.filter((i: any) => i.repo === criticalRepoFilter);
        const sorted = [...filtered].sort((a, b) => {
          if (criticalSort.key === "repo") {
            const cmp = a.repo.localeCompare(b.repo);
            return criticalSort.dir === "asc" ? cmp : -cmp;
          }
          const ageA = daysAgo(a.created_at);
          const ageB = daysAgo(b.created_at);
          return criticalSort.dir === "asc" ? ageA - ageB : ageB - ageA;
        });
        const toggleCriticalSort = (key: "repo" | "age") => {
          setCriticalSort((prev) =>
            prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
          );
        };

        return (
          <div className={cn(card, "overflow-hidden border-l-[3px] border-l-red-500")}>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-100 dark:border-white/[0.06]">
              <Flag className="w-4 h-4 text-red-500" />
              <h3 className="text-xs font-medium text-red-600 dark:text-red-400 uppercase tracking-wider">
                Critical Issues ({criticalData!.totalCount})
              </h3>
              <select
                value={criticalRepoFilter}
                onChange={(e) => setCriticalRepoFilter(e.target.value)}
                className="ml-auto px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] text-stone-600 dark:text-neutral-400 cursor-pointer focus:outline-none focus:border-red-400"
              >
                <option value="all">All Repos ({criticalIssues.length})</option>
                {repoOptions.map(({ repo, count }) => (
                  <option key={repo} value={repo}>{repo} ({count})</option>
                ))}
              </select>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-stone-100 dark:border-white/[0.06] text-left">
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-3 py-2 text-xs font-medium text-stone-500 dark:text-neutral-400">Issue</th>
                  <th className="px-3 py-2 text-xs font-medium text-stone-500 dark:text-neutral-400">Title</th>
                  <th
                    onClick={() => toggleCriticalSort("repo")}
                    className="px-3 py-2 text-xs font-medium text-stone-500 dark:text-neutral-400 cursor-pointer hover:text-stone-700 dark:hover:text-neutral-300"
                  >
                    Repo {criticalSort.key === "repo" && (criticalSort.dir === "asc" ? <ChevronUp className="w-3 h-3 inline ml-0.5" /> : <ChevronDown className="w-3 h-3 inline ml-0.5" />)}
                  </th>
                  <th className="px-3 py-2 text-xs font-medium text-stone-500 dark:text-neutral-400">Assignees</th>
                  <th
                    onClick={() => toggleCriticalSort("age")}
                    className="px-3 py-2 text-xs font-medium text-stone-500 dark:text-neutral-400 text-right cursor-pointer hover:text-stone-700 dark:hover:text-neutral-300"
                  >
                    Age {criticalSort.key === "age" && (criticalSort.dir === "asc" ? <ChevronUp className="w-3 h-3 inline ml-0.5" /> : <ChevronDown className="w-3 h-3 inline ml-0.5" />)}
                  </th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50 dark:divide-white/[0.06]">
                {sorted.map((issue: any) => (
                  <tr key={issue.id} className="hover:bg-red-50/50 dark:hover:bg-red-500/[0.04]">
                    <td className="px-3 py-2">
                      <Flag className="w-4 h-4 text-red-500" />
                    </td>
                    <td className="px-3 py-2 text-stone-500 dark:text-neutral-400 whitespace-nowrap">#{issue.number}</td>
                    <td className="px-3 py-2 max-w-md truncate text-stone-800 dark:text-neutral-200">{issue.title}</td>
                    <td className="px-3 py-2 text-stone-500 dark:text-neutral-400">{issue.repo}</td>
                    <td className="px-3 py-2 text-stone-500 dark:text-neutral-400">
                      {(issue.assignees ?? []).length > 0
                        ? (issue.assignees as any[]).map((a: any) => a.login).join(", ")
                        : <span className="text-stone-300 dark:text-neutral-600">—</span>
                      }
                    </td>
                    <td className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      daysAgo(issue.created_at) > 7 ? "text-red-500 font-medium" : "text-stone-400 dark:text-neutral-500",
                    )}>
                      {daysAgo(issue.created_at)}d
                    </td>
                    <td className="px-3 py-2">
                      <a href={issue.html_url} target="_blank" rel="noopener noreferrer" className="text-stone-300 hover:text-brand">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* ──── Issue List ──── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-neutral-200">All Issues</h3>
          <button
            onClick={startSync}
            disabled={syncModalOpen}
            className={cn(
              "flex items-center gap-1.5 text-xs text-stone-500 dark:text-neutral-400 hover:text-brand cursor-pointer",
              syncModalOpen && "opacity-50 cursor-not-allowed",
            )}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", (openFetching || closedFetching) && "animate-spin")} />
            Sync
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="flex items-center bg-stone-100 dark:bg-dark-overlay rounded-lg p-0.5">
            {(["all", "unassigned", "assigned"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => { setAssignmentFilter(opt); resetPages(); }}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded-md transition-colors capitalize",
                  assignmentFilter === opt
                    ? "bg-white dark:bg-dark-raised text-stone-800 dark:text-neutral-200 shadow-sm"
                    : "text-stone-500 dark:text-neutral-400 hover:text-stone-700 dark:hover:text-neutral-300",
                )}
              >
                {opt}
              </button>
            ))}
          </div>

          <PersonSelect
            value={assigneeFilter.length > 0 ? assigneeFilter : null}
            onChange={(v) => {
              setAssigneeFilter(Array.isArray(v) ? v : v ? [v] : []);
              resetPages();
            }}
            options={memberLogins.map((l) => ({ value: l, label: l }))}
            placeholder="All Assignees"
            multi
          />

          <SearchableSelect
            value={repoFilter}
            onChange={(v) => {
              setRepoFilter(v);
              resetPages();
            }}
            options={[
              { value: "all", label: "All Repos" },
              ...repoList.map((r) => ({ value: r, label: r })),
            ]}
            placeholder="All Repos"
          />

          <select
            value={labelFilter}
            onChange={(e) => {
              setLabelFilter(e.target.value);
              resetPages();
            }}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] text-stone-600 dark:text-neutral-400 cursor-pointer focus:outline-none focus:border-brand"
          >
            <option value="all">All Labels</option>
            {labelList.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>

          <span className="text-xs text-stone-400 dark:text-neutral-500 ml-auto">
            {openTotal} open, {closedTotal} closed
          </span>
        </div>

        {/* Table */}
        <div className={cn(card, "overflow-hidden")}>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-stone-100 dark:border-white/[0.06] text-left">
                <th className="px-3 py-2 w-8"></th>
                <th
                  onClick={() => toggleSort("number")}
                  className="px-3 py-2 text-xs font-medium text-stone-500 dark:text-neutral-400 cursor-pointer hover:text-stone-700 dark:hover:text-neutral-300"
                >
                  Issue <SortIcon column="number" activeSortKey={sortKey} activeSortDirection={sortDir} />
                </th>
                <th
                  onClick={() => toggleSort("title")}
                  className="px-3 py-2 text-xs font-medium text-stone-500 dark:text-neutral-400 cursor-pointer hover:text-stone-700 dark:hover:text-neutral-300"
                >
                  Title <SortIcon column="title" activeSortKey={sortKey} activeSortDirection={sortDir} />
                </th>
                <th
                  onClick={() => toggleSort("repo")}
                  className="px-3 py-2 text-xs font-medium text-stone-500 dark:text-neutral-400 cursor-pointer hover:text-stone-700 dark:hover:text-neutral-300"
                >
                  Repo <SortIcon column="repo" activeSortKey={sortKey} activeSortDirection={sortDir} />
                </th>
                <th className="px-3 py-2 text-xs font-medium text-stone-500 dark:text-neutral-400">Labels</th>
                <th className="px-3 py-2 text-xs font-medium text-stone-500 dark:text-neutral-400">Assignees</th>
                <th
                  onClick={() => toggleSort("created_at")}
                  className="px-3 py-2 text-xs font-medium text-stone-500 text-right cursor-pointer hover:text-stone-700"
                >
                  Age <SortIcon column="created_at" activeSortKey={sortKey} activeSortDirection={sortDir} />
                </th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50 dark:divide-white/[0.06]">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center">
                    <Spinner className="mx-auto" />
                  </td>
                </tr>
              ) : openTotal === 0 && closedTotal === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-stone-400 dark:text-neutral-500">
                    No issues found
                  </td>
                </tr>
              ) : (
                <>
                  {[...(openData?.data ?? [])].sort((a, b) => (isCritical(b) ? 1 : 0) - (isCritical(a) ? 1 : 0)).map((issue) => (
                    <IssueRow key={issue.id} issue={issue} closed={false} allPeople={memberLogins} onAssign={(assignees) => updateAssignees.mutate({ repo: issue.repo, issueNumber: issue.number, assignees })} />
                  ))}

                  {openPages > 1 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-2">
                        <PaginationControls
                          page={openPage}
                          totalPages={openPages}
                          onPageChange={setOpenPage}
                          isFetching={openFetching}
                        />
                      </td>
                    </tr>
                  )}

                  {closedTotal > 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-2 text-xs font-medium text-stone-400 dark:text-neutral-500 uppercase tracking-wider bg-stone-50 dark:bg-white/[0.04] border-t-2 border-stone-200 dark:border-white/[0.06]"
                      >
                        Closed During Sprint
                      </td>
                    </tr>
                  )}

                  {(closedData?.data ?? []).map((issue) => (
                    <IssueRow key={issue.id} issue={issue} closed allPeople={memberLogins} onAssign={(assignees) => updateAssignees.mutate({ repo: issue.repo, issueNumber: issue.number, assignees })} />
                  ))}

                  {closedPages > 1 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-2">
                        <PaginationControls
                          page={closedPage}
                          totalPages={closedPages}
                          onPageChange={setClosedPage}
                          isFetching={closedFetching}
                        />
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

// ──── Stat Card ────

function StatCard({ label, value, icon, accent, loading }: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent?: "amber" | "red" | "brand";
  loading?: boolean;
}) {
  const accentBorder = accent === "amber"
    ? "border-l-amber-400"
    : accent === "red"
      ? "border-l-red-400"
      : accent === "brand"
        ? "border-l-brand"
        : "border-l-transparent";

  return (
    <div className={cn(
      "bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-xl p-4 border-l-[3px]",
      accentBorder,
    )}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-stone-500 dark:text-neutral-400">{label}</span>
        {icon}
      </div>
      {loading ? (
        <div className="h-7 w-12 bg-stone-100 dark:bg-dark-overlay rounded animate-pulse" />
      ) : (
        <span className="text-2xl font-bold text-stone-800 dark:text-neutral-100 tabular-nums">{value}</span>
      )}
    </div>
  );
}

// ──── Mini Bar Chart (for closed per week) ────

function DailyBarChart({ data, selectedDay, onSelectDay }: {
  data: { day: string; count: number; critical: number }[];
  selectedDay: string | null;
  onSelectDay: (day: string) => void;
}) {
  // Fill all 28 days so there are no gaps
  const filled = useMemo(() => {
    const map = new Map(data.map((d) => [d.day, d]));
    const days: { day: string; count: number; critical: number }[] = [];
    const now = new Date();
    for (let i = 27; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const entry = map.get(key);
      days.push({ day: key, count: entry?.count ?? 0, critical: entry?.critical ?? 0 });
    }
    return days;
  }, [data]);

  const max = Math.max(...filled.map((d) => d.count), 1);
  const barHeight = 120;

  // Y-axis ticks (0, mid, max)
  const ticks = max <= 2 ? [0, max] : [0, Math.round(max / 2), max];

  return (
    <div className="flex gap-2">
      {/* Y-axis */}
      <div className="flex flex-col justify-between shrink-0 pr-1" style={{ height: barHeight }}>
        {[...ticks].reverse().map((t) => (
          <span key={t} className="text-[10px] text-stone-400 dark:text-neutral-500 tabular-nums leading-none">{t}</span>
        ))}
      </div>
      {/* Bars */}
      <div className="flex-1 flex items-end gap-[2px]" style={{ height: barHeight }}>
        {filled.map((d, i) => {
          const heightPct = d.count === 0 ? 0 : (d.count / max) * 100;
          const criticalPct = d.critical > 0 ? (d.critical / max) * 100 : 0;
          const normalPct = heightPct - criticalPct;
          const dayNum = new Date(d.day + "T00:00:00").getDate();
          const dateLabel = new Date(d.day + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
          const showMonthLabel = i === 0 || dayNum === 1;
          const isSelected = selectedDay === d.day;
          return (
            <div
              key={d.day}
              className={cn("flex-1 flex flex-col items-center group relative", d.count > 0 && "cursor-pointer")}
              onClick={() => d.count > 0 && onSelectDay(d.day)}
            >
              <div className="w-full flex flex-col items-stretch justify-end" style={{ height: barHeight - 20 }}>
                {d.count > 0 ? (
                  <div className={cn("w-full flex flex-col rounded-sm overflow-hidden transition-all", isSelected && "ring-2 ring-brand ring-offset-1")} style={{ height: `${heightPct}%`, minHeight: 3 }}>
                    {normalPct > 0 && (
                      <div className="w-full bg-brand/60 hover:bg-brand/80 transition-colors" style={{ flexGrow: d.count - d.critical }} />
                    )}
                    {criticalPct > 0 && (
                      <div className="w-full bg-red-500 hover:bg-red-600 transition-colors" style={{ flexGrow: d.critical }} />
                    )}
                  </div>
                ) : (
                  <div className="w-full" style={{ height: "1px", minHeight: 1 }}>
                    <div className="w-full bg-stone-200 dark:bg-dark-overlay" style={{ height: "1px" }} />
                  </div>
                )}
              </div>
              <span className={cn("text-[8px] whitespace-nowrap mt-0.5 leading-tight", isSelected ? "text-brand font-semibold" : "text-stone-400 dark:text-neutral-500")}>
                {showMonthLabel ? dateLabel : dayNum}
              </span>
              {d.count > 0 && (
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 hidden group-hover:block bg-stone-800 dark:bg-neutral-700 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap z-10">
                  {d.count}{d.critical > 0 ? ` (${d.critical} critical)` : ""} — {dateLabel}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──── Pagination ────

function PaginationControls({
  page,
  totalPages,
  onPageChange,
  isFetching,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  isFetching: boolean;
}) {
  return (
    <div className="flex items-center justify-center gap-3">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="p-1 text-stone-400 dark:text-neutral-500 hover:text-stone-600 dark:hover:text-neutral-400 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className={cn("text-xs text-stone-500 dark:text-neutral-400 tabular-nums", isFetching && "opacity-50")}>
        Page {page} of {totalPages}
      </span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="p-1 text-stone-400 dark:text-neutral-500 hover:text-stone-600 dark:hover:text-neutral-400 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// ──── Issue Row ────

function IssueRow({ issue, closed, allPeople, onAssign }: { issue: any; closed: boolean; allPeople: string[]; onAssign: (assignees: string[]) => void }) {
  const age = daysAgo(issue.created_at);

  return (
    <tr className={cn(
      "hover:bg-stone-50 dark:hover:bg-white/[0.06]",
      closed && "text-stone-400 dark:text-neutral-500",
      !closed && isCritical(issue) && "bg-red-50/50 dark:bg-red-500/[0.04]",
    )}>
      <td className="px-3 py-2">
        {closed ? (
          <CircleCheck className="w-4 h-4 text-accent" />
        ) : isCritical(issue) ? (
          <Flag className="w-4 h-4 text-red-500" />
        ) : (
          <CircleDot className="w-4 h-4 text-green-600" />
        )}
      </td>
      <td className="px-3 py-2 text-stone-500 dark:text-neutral-400 whitespace-nowrap">#{issue.number}</td>
      <td className="px-3 py-2 max-w-md truncate">{issue.title}</td>
      <td className="px-3 py-2 text-stone-500 dark:text-neutral-400 text-xs">{issue.repo || "—"}</td>
      <td className="px-3 py-2">
        <div className="flex gap-1 flex-wrap">
          {(issue.labels ?? []).slice(0, 3).map((l: any) => {
            const style = getLabelStyle(l.name, l.color);
            return (
              <span
                key={l.name}
                className={cn(
                  "text-xs px-1.5 py-0.5 rounded-full font-medium",
                  style.bg,
                  style.text,
                )}
              >
                {l.name}
              </span>
            );
          })}
        </div>
      </td>
      <td className="px-3 py-2">
        <AssignDropdown
          owners={(issue.assignees ?? []).map((a: any) => a.login)}
          allPeople={allPeople}
          onChange={onAssign}
        />
      </td>
      <td
        className={cn(
          "px-3 py-2 text-right tabular-nums",
          age > 30 && !closed ? "text-amber-600 font-medium" : "text-stone-400 dark:text-neutral-500",
        )}
      >
        {age}d
      </td>
      <td className="px-3 py-2">
        <a
          href={issue.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-stone-300 hover:text-brand"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </td>
    </tr>
  );
}
