/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo, useCallback } from "react";
import { useOpenPRs, useMergedPRs } from "@/hooks/useGitHub";
import { GitPullRequest, GitMerge, ExternalLink, ChevronUp, ChevronDown, RefreshCw, Check, X, Loader2, AlertCircle } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { PersonSelect } from "@/components/ui/PersonSelect";
import { cn } from "@/lib/cn";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useQueryClient } from "@tanstack/react-query";
import { triggerSyncWithProgress, type SyncProgress } from "@/lib/github";

function daysAgo(date: string): number {
  return Math.floor(
    (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24),
  );
}

type SortKey = "repo" | "title" | "author" | "age" | "reviewers";
type SortDir = "asc" | "desc";

function SortIcon({ column, activeSortKey, activeSortDirection }: { column: SortKey; activeSortKey: SortKey; activeSortDirection: SortDir }) {
  if (activeSortKey !== column) return null;
  return activeSortDirection === "asc" ? (
    <ChevronUp className="w-3 h-3 inline ml-0.5" />
  ) : (
    <ChevronDown className="w-3 h-3 inline ml-0.5" />
  );
}

interface PRsTabProps {
  repoNames: string[];
  navFilter?: import("@/lib/types").NavFilter | null;
}

type PRView = "open" | "merged";

export function PRsTab({ repoNames, navFilter }: PRsTabProps) {
  const qc = useQueryClient();
  const [view, setView] = useState<PRView>("open");
  const { data: openPRs, isLoading: openLoading, isFetching: openFetching } = useOpenPRs(repoNames);
  const { data: mergedPRs, isLoading: mergedLoading, isFetching: mergedFetching } = useMergedPRs(repoNames);
  const [personFilter, setPersonFilter] = useState<string[]>(navFilter?.person ? [navFilter.person] : []);
  const [repoFilter, setRepoFilter] = useState<string>("all");

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncedRepos, setSyncedRepos] = useState<string[]>([]);

  const isFetching = view === "open" ? openFetching : mergedFetching;

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
        qc.invalidateQueries({ queryKey: ["prs"] });
        qc.invalidateQueries({ queryKey: ["repos"] });
      }
    });
  }, [qc]);

  const prs = view === "open" ? openPRs : mergedPRs;
  const isLoading = view === "open" ? openLoading : mergedLoading;
  const [sortKey, setSortKey] = useState<SortKey>("age");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Unique authors and repos for dropdowns
  const authors = useMemo(() => {
    const set = new Set<string>();
    for (const pr of prs ?? []) {
      if (pr.user?.login) set.add(pr.user.login);
    }
    return Array.from(set).sort();
  }, [prs]);

  const repos = useMemo(() => {
    const set = new Set<string>();
    for (const pr of prs ?? []) {
      const repo = pr.head.repo?.name;
      if (repo) set.add(repo);
    }
    return Array.from(set).sort();
  }, [prs]);

  const filtered = useMemo(() => {
    let list = prs ?? [];
    if (personFilter.length > 0) {
      list = list.filter((pr: any) => personFilter.includes(pr.user?.login));
    }
    if (repoFilter !== "all") {
      list = list.filter((pr: any) => pr.head.repo?.name === repoFilter);
    }
    return list;
  }, [prs, personFilter, repoFilter]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a: any, b: any) => {
      switch (sortKey) {
        case "repo":
          return dir * (a.head.repo?.name ?? "").localeCompare(b.head.repo?.name ?? "");
        case "title":
          return dir * a.title.localeCompare(b.title);
        case "author":
          return dir * (a.user?.login ?? "").localeCompare(b.user?.login ?? "");
        case "age":
          return dir * (daysAgo(a.created_at) - daysAgo(b.created_at));
        case "reviewers":
          return dir * ((a.requested_reviewers?.length ?? 0) - (b.requested_reviewers?.length ?? 0));
        default:
          return 0;
      }
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const syncDone = syncProgress?.phase === "done";
  const syncError = syncProgress?.phase === "error";

  return (
    <div className="space-y-4">
      {/* Sync Modal */}
      {syncModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div role="dialog" aria-modal="true" className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
              <h3 className="text-sm font-semibold text-stone-800">
                {syncDone ? "Sync Complete" : syncError ? "Sync Failed" : "Syncing from GitHub"}
              </h3>
              {(syncDone || syncError) && (
                <button
                  onClick={() => setSyncModalOpen(false)}
                  className="text-stone-400 hover:text-stone-600 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="px-5 py-4 space-y-3">
              {syncProgress && syncProgress.total > 0 && (
                <div>
                  <div className="flex justify-between text-xs text-stone-500 mb-1">
                    <span>{syncDone ? "All repos synced" : `Syncing repo ${Math.min(syncedRepos.length + 1, syncProgress.total)} of ${syncProgress.total}`}</span>
                    <span>{Math.round(((syncDone ? syncProgress.total : syncedRepos.length) / syncProgress.total) * 100)}%</span>
                  </div>
                  <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        syncError ? "bg-red-500" : "bg-accent",
                      )}
                      style={{
                        width: `${((syncDone ? syncProgress.total : syncedRepos.length) / syncProgress.total) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}
              {syncProgress?.phase === "init" && (
                <div className="flex items-center gap-2 text-xs text-stone-500">
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
                <div className="flex items-center gap-2 text-xs text-stone-600">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                  <span className="font-medium">{syncProgress.repo}</span>
                </div>
              )}
              {syncedRepos.length > 0 && (
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {syncedRepos.map((repo) => (
                    <div key={repo} className="flex items-center gap-2 text-xs text-stone-500">
                      <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      {repo}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {(syncDone || syncError) && (
              <div className="px-5 py-3 border-t border-stone-100">
                <button
                  onClick={() => setSyncModalOpen(false)}
                  className="w-full px-4 py-2 text-xs font-medium text-white bg-accent rounded-lg hover:bg-accent/90 cursor-pointer"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* View toggle + Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-stone-200 overflow-hidden">
          <button
            onClick={() => setView("open")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors",
              view === "open"
                ? "bg-accent text-white"
                : "bg-white  text-stone-600  hover:bg-stone-50  ",
            )}
          >
            Open
          </button>
          <button
            onClick={() => setView("merged")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors border-l border-stone-200  ",
              view === "merged"
                ? "bg-accent text-white"
                : "bg-white  text-stone-600  hover:bg-stone-50  ",
            )}
          >
            Merged
          </button>
        </div>

        <PersonSelect
          value={personFilter.length > 0 ? personFilter : null}
          onChange={(v) => setPersonFilter(Array.isArray(v) ? v : v ? [v] : [])}
          options={authors.map((a) => ({ value: a, label: a }))}
          placeholder="All Authors"
          multi
        />

        <SearchableSelect
          value={repoFilter}
          onChange={setRepoFilter}
          options={[
            { value: "all", label: "All Repos" },
            ...repos.map((r) => ({ value: r, label: r })),
          ]}
          placeholder="All Repos"
        />

        <button
          onClick={startSync}
          disabled={syncModalOpen}
          className={cn(
            "flex items-center gap-1.5 text-xs text-stone-500  hover:text-accent cursor-pointer",
            syncModalOpen && "opacity-50 cursor-not-allowed",
          )}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
          Sync from GitHub
        </button>

        <span className="text-xs text-stone-400 ml-auto">
          {sorted.length} of {(prs ?? []).length} PRs
        </span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 text-left">
              <th
                onClick={() => toggleSort("repo")}
                className="px-4 py-2.5 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700"
              >
                PR <SortIcon column="repo" activeSortKey={sortKey} activeSortDirection={sortDir} />
              </th>
              <th
                onClick={() => toggleSort("title")}
                className="px-4 py-2.5 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700"
              >
                Title <SortIcon column="title" activeSortKey={sortKey} activeSortDirection={sortDir} />
              </th>
              <th
                onClick={() => toggleSort("author")}
                className="px-4 py-2.5 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700"
              >
                Author <SortIcon column="author" activeSortKey={sortKey} activeSortDirection={sortDir} />
              </th>
              <th
                onClick={() => toggleSort("reviewers")}
                className="px-4 py-2.5 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700"
              >
                Reviewers <SortIcon column="reviewers" activeSortKey={sortKey} activeSortDirection={sortDir} />
              </th>
              <th
                onClick={() => toggleSort("age")}
                className="px-4 py-2.5 text-xs font-medium text-stone-500 text-right cursor-pointer hover:text-stone-700"
              >
                Age <SortIcon column="age" activeSortKey={sortKey} activeSortDirection={sortDir} />
              </th>
              <th className="px-4 py-2.5 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center">
                  <Spinner className="mx-auto" />
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-stone-400">
                  No pull requests found
                </td>
              </tr>
            ) : (
              sorted.map((pr) => {
                const age = daysAgo(pr.created_at);
                const isStale = age > 7;
                const repoName = pr.head.repo?.name ?? "";
                return (
                  <tr
                    key={pr.id}
                    className={cn("hover:bg-stone-50  ", isStale && "bg-amber-50  ")}
                  >
                    <td className="px-4 py-2.5 text-stone-500 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {view === "merged" ? (
                          <GitMerge className="w-4 h-4 text-accent" />
                        ) : (
                          <GitPullRequest
                            className={cn(
                              "w-4 h-4",
                              pr.draft ? "text-stone-400  " : "text-green-600",
                            )}
                          />
                        )}
                        {repoName}#{pr.number}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 max-w-md">
                      <div className="text-stone-800 truncate">
                        {pr.title}
                        {pr.draft && (
                          <span className="ml-2 text-xs bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded-full">
                            draft
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-stone-400 truncate">
                        {pr.head.ref} → {pr.base.ref}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-stone-500">{pr.user?.login}</td>
                    <td className="px-4 py-2.5 text-stone-500 text-xs">
                      {(pr.requested_reviewers ?? []).length > 0
                        ? (pr.requested_reviewers ?? []).map((r: any) => r.login).join(", ")
                        : <span className="text-stone-300">none</span>}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2.5 text-right tabular-nums",
                        isStale ? "text-amber-600 font-medium" : "text-stone-400  ",
                      )}
                    >
                      {age}d
                    </td>
                    <td className="px-4 py-2.5">
                      <a
                        href={pr.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-stone-300 hover:text-accent"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
