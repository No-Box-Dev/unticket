import { useState, useMemo, useCallback } from "react";
import { usePaginatedIssues, useIssueLabels, useRepos, useOrgMembers, useUpdateIssueAssignees } from "@/hooks/useGitHub";
import { useSprint, useSettings } from "@/hooks/useConfigRepo";
import { CircleDot, CircleCheck, ExternalLink, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, RefreshCw, Check, X, Loader2, AlertCircle } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { AssignDropdown } from "@/components/sprint/AssignDropdown";
import { useQueryClient } from "@tanstack/react-query";
import { triggerSyncWithProgress, type SyncProgress } from "@/lib/github";

function daysAgo(date: string): number {
  return Math.floor(
    (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24),
  );
}

type SortKey = "number" | "title" | "repo" | "updated_at" | "created_at";

const labelColors: Record<string, { bg: string; text: string }> = {
  bug: { bg: "bg-red-50", text: "text-red-700" },
  enhancement: { bg: "bg-blue-50", text: "text-blue-700" },
  feature: { bg: "bg-blue-50", text: "text-blue-700" },
  investigation: { bg: "bg-yellow-50", text: "text-yellow-700" },
  documentation: { bg: "bg-accent-light", text: "text-accent" },
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

interface IssuesTabProps {
  repoNames: string[];
}

export function IssuesTab(_props: IssuesTabProps) {
  const qc = useQueryClient();
  const { data: sprint, isLoading: sprintLoading } = useSprint();
  const { data: settings } = useSettings();
  const { data: labels } = useIssueLabels();
  const { data: repos } = useRepos();
  const { data: members } = useOrgMembers();
  const updateAssignees = useUpdateIssueAssignees();

  const memberLogins = useMemo(() => members?.map((m) => m.login).sort() ?? [], [members]);

  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [repoFilter, setRepoFilter] = useState<string>("all");
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [openPage, setOpenPage] = useState(1);
  const [closedPage, setClosedPage] = useState(1);

  const teams = useMemo(() => settings?.teams ?? [], [settings]);

  // Resolve team filter → repo names
  const filteredRepos = useMemo(() => {
    if (teamFilter !== "all") {
      const team = teams.find((t) => t.name === teamFilter);
      return team?.repos ?? [];
    }
    if (repoFilter !== "all") {
      return [repoFilter];
    }
    return undefined; // no repo filter
  }, [teamFilter, repoFilter, teams]);

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
    label: labelFilter !== "all" ? labelFilter : undefined,
    sort: sortKey,
    sortDir,
  });

  // Closed issues query (since sprint start, waits for sprint config)
  const {
    data: closedData,
    isLoading: closedLoading,
    isFetching: closedFetching,
  } = usePaginatedIssues({
    state: "closed",
    page: closedPage,
    pageSize: PAGE_SIZE,
    repos: filteredRepos,
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

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortDir === "asc" ? (
      <ChevronUp className="w-3 h-3 inline ml-0.5" />
    ) : (
      <ChevronDown className="w-3 h-3 inline ml-0.5" />
    );
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
    });
  }, [qc]);

  const repoList = useMemo(() => {
    return repos?.map((r) => r.name).sort() ?? [];
  }, [repos]);

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

  return (
    <div className="space-y-4">
      {/* Sync Modal */}
      {syncModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-stone-900 rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 dark:border-stone-800">
              <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-200">
                {syncDone ? "Sync Complete" : syncError ? "Sync Failed" : "Syncing from GitHub"}
              </h3>
              {(syncDone || syncError) && (
                <button
                  onClick={() => setSyncModalOpen(false)}
                  className="text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-400 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="px-5 py-4 space-y-3">
              {/* Progress bar */}
              {syncProgress && syncProgress.total > 0 && (
                <div>
                  <div className="flex justify-between text-xs text-stone-500 dark:text-stone-400 mb-1">
                    <span>{syncDone ? "All repos synced" : `Syncing repo ${Math.min(syncedRepos.length + 1, syncProgress.total)} of ${syncProgress.total}`}</span>
                    <span>{Math.round(((syncDone ? syncProgress.total : syncedRepos.length) / syncProgress.total) * 100)}%</span>
                  </div>
                  <div className="h-2 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
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

              {/* Init phase */}
              {syncProgress?.phase === "init" && (
                <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Initializing sync...
                </div>
              )}

              {/* Error */}
              {syncError && (
                <div className="flex items-center gap-2 text-xs text-red-600">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {syncProgress.error}
                </div>
              )}

              {/* Current repo */}
              {syncProgress?.phase === "syncing" && syncProgress.repo && (
                <div className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-brand" />
                  <span className="font-medium">{syncProgress.repo}</span>
                </div>
              )}

              {/* Synced repo list */}
              {syncedRepos.length > 0 && (
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {syncedRepos.map((repo) => (
                    <div key={repo} className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                      <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      {repo}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {(syncDone || syncError) && (
              <div className="px-5 py-3 border-t border-stone-100 dark:border-stone-800">
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {teams.length > 1 && (
          <select
            value={teamFilter}
            onChange={(e) => {
              setTeamFilter(e.target.value);
              setRepoFilter("all");
              resetPages();
            }}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 cursor-pointer focus:outline-none focus:border-brand"
          >
            <option value="all">All Teams</option>
            {teams.map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
        )}

        <SearchableSelect
          value={repoFilter}
          onChange={(v) => {
            setRepoFilter(v);
            setTeamFilter("all");
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
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 cursor-pointer focus:outline-none focus:border-brand"
        >
          <option value="all">All Labels</option>
          {labelList.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>

        <button
          onClick={startSync}
          disabled={syncModalOpen}
          className={cn(
            "flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400 hover:text-brand cursor-pointer",
            syncModalOpen && "opacity-50 cursor-not-allowed",
          )}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", (openFetching || closedFetching) && "animate-spin")} />
          Sync from GitHub
        </button>

        <span className="text-xs text-stone-400 dark:text-stone-500 ml-auto">
          {openTotal} open, {closedTotal} closed
        </span>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-stone-900 rounded-xl border border-stone-200 dark:border-stone-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 dark:border-stone-800 text-left">
              <th className="px-4 py-2.5 w-8"></th>
              <th
                onClick={() => toggleSort("number")}
                className="px-4 py-2.5 text-xs font-medium text-stone-500 dark:text-stone-400 cursor-pointer hover:text-stone-700 dark:hover:text-stone-300"
              >
                Issue <SortIcon col="number" />
              </th>
              <th
                onClick={() => toggleSort("title")}
                className="px-4 py-2.5 text-xs font-medium text-stone-500 dark:text-stone-400 cursor-pointer hover:text-stone-700 dark:hover:text-stone-300"
              >
                Title <SortIcon col="title" />
              </th>
              <th className="px-4 py-2.5 text-xs font-medium text-stone-500 dark:text-stone-400">Team</th>
              <th
                onClick={() => toggleSort("repo")}
                className="px-4 py-2.5 text-xs font-medium text-stone-500 dark:text-stone-400 cursor-pointer hover:text-stone-700 dark:hover:text-stone-300"
              >
                Repo <SortIcon col="repo" />
              </th>
              <th className="px-4 py-2.5 text-xs font-medium text-stone-500 dark:text-stone-400">Labels</th>
              <th className="px-4 py-2.5 text-xs font-medium text-stone-500 dark:text-stone-400">Assignees</th>
              <th
                onClick={() => toggleSort("created_at")}
                className="px-4 py-2.5 text-xs font-medium text-stone-500 text-right cursor-pointer hover:text-stone-700"
              >
                Age <SortIcon col="created_at" />
              </th>
              <th className="px-4 py-2.5 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
            {isLoading ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center">
                  <Spinner className="mx-auto" />
                </td>
              </tr>
            ) : openTotal === 0 && closedTotal === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-stone-400 dark:text-stone-500">
                  No issues found
                </td>
              </tr>
            ) : (
              <>
                {(openData?.data ?? []).map((issue) => (
                  <IssueRow key={issue.id} issue={issue} closed={false} teams={teams} allPeople={memberLogins} onAssign={(assignees) => updateAssignees.mutate({ repo: issue.repo, issueNumber: issue.number, assignees })} />
                ))}

                {/* Open pagination */}
                {openPages > 1 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-2">
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
                      colSpan={9}
                      className="px-4 py-2 text-xs font-medium text-stone-400 dark:text-stone-500 uppercase tracking-wider bg-stone-50 dark:bg-stone-800/50 border-t-2 border-stone-200 dark:border-stone-700"
                    >
                      Closed During Sprint
                    </td>
                  </tr>
                )}

                {(closedData?.data ?? []).map((issue) => (
                  <IssueRow key={issue.id} issue={issue} closed teams={teams} allPeople={memberLogins} onAssign={(assignees) => updateAssignees.mutate({ repo: issue.repo, issueNumber: issue.number, assignees })} />
                ))}

                {/* Closed pagination */}
                {closedPages > 1 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-2">
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
  );
}

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
        className="p-1 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-400 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className={cn("text-xs text-stone-500 dark:text-stone-400 tabular-nums", isFetching && "opacity-50")}>
        Page {page} of {totalPages}
      </span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="p-1 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-400 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function IssueRow({ issue, closed, teams, allPeople, onAssign }: { issue: any; closed: boolean; teams: { name: string; color: string; repos: string[] }[]; allPeople: string[]; onAssign: (assignees: string[]) => void }) {
  const age = daysAgo(issue.created_at);
  const team = teams.find((t) => (t.repos ?? []).includes(issue.repo));

  return (
    <tr className={cn("hover:bg-stone-50 dark:hover:bg-stone-800/50", closed && "text-stone-400 dark:text-stone-500")}>
      <td className="px-4 py-2.5">
        {closed ? (
          <CircleCheck className="w-4 h-4 text-accent" />
        ) : (
          <CircleDot className="w-4 h-4 text-green-600" />
        )}
      </td>
      <td className="px-4 py-2.5 text-stone-500 dark:text-stone-400 whitespace-nowrap">#{issue.number}</td>
      <td className="px-4 py-2.5 max-w-md truncate">{issue.title}</td>
      <td className="px-4 py-2.5">
        {team ? (
          <span className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: team.color }}
            />
            {team.name}
          </span>
        ) : (
          <span className="text-xs text-stone-300">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-stone-500 dark:text-stone-400 text-xs">{issue.repo || "—"}</td>
      <td className="px-4 py-2.5">
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
      <td className="px-4 py-2.5">
        <AssignDropdown
          owners={(issue.assignees ?? []).map((a: any) => a.login)}
          allPeople={allPeople}
          onChange={onAssign}
        />
      </td>
      <td
        className={cn(
          "px-4 py-2.5 text-right tabular-nums",
          age > 30 && !closed ? "text-amber-600 font-medium" : "text-stone-400 dark:text-stone-500",
        )}
      >
        {age}d
      </td>
      <td className="px-4 py-2.5">
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
