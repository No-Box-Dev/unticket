/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from "react";
import { useOpenPRs, useMergedPRs, usePRStats } from "@/hooks/useGitHub";
import { useFeedProjects } from "@/hooks/useNoxlink";
import { GitPullRequest, GitMerge, ExternalLink, ChevronUp, ChevronDown, FileEdit } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { PersonSelect } from "@/components/ui/PersonSelect";
import { cn } from "@/lib/cn";
import { SearchableSelect } from "@/components/ui/SearchableSelect";

function daysAgo(date: string): number {
  return Math.floor(
    (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24),
  );
}

type SortKey = "repo" | "title" | "author" | "age" | "reviewers";
type SortDir = "asc" | "desc";

const card = "bg-white  border border-stone-200  rounded-xl";

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
  const [view, setView] = useState<PRView>("open");
  const { data: feedProjects } = useFeedProjects();
  const archivedRepos = useMemo(
    () => new Set((feedProjects ?? []).filter((p) => p.archived && p.repo).map((p) => p.repo!)),
    [feedProjects],
  );
  const activeRepoNames = useMemo(
    () => repoNames.filter((n) => !archivedRepos.has(n)),
    [repoNames, archivedRepos],
  );
  const { data: openPRs, isLoading: openLoading } = useOpenPRs(activeRepoNames);
  const { data: mergedPRs, isLoading: mergedLoading } = useMergedPRs(activeRepoNames);
  const { data: prStats } = usePRStats();
  const [personFilter, setPersonFilter] = useState<string[]>(navFilter?.person ? [navFilter.person] : []);
  const [repoFilter, setRepoFilter] = useState<string>("all");

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
    if (archivedRepos.size > 0) {
      list = list.filter((pr: any) => !archivedRepos.has(pr.head.repo?.name));
    }
    if (personFilter.length > 0) {
      list = list.filter((pr: any) => personFilter.includes(pr.user?.login));
    }
    if (repoFilter !== "all") {
      list = list.filter((pr: any) => pr.head.repo?.name === repoFilter);
    }
    return list;
  }, [prs, personFilter, repoFilter, archivedRepos]);

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

  const byRepo = prStats?.byRepo;
  const repoMax = useMemo(() => {
    if (!byRepo?.length) return 1;
    return Math.max(...byRepo.map((r) => r.count), 1);
  }, [byRepo]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  return (
    <div className="space-y-6">
      {/* Open PRs by Repo */}
      <div className={cn(card, "p-5")}>
        <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wider mb-4">Open PRs by Repo</h3>
        {!prStats?.byRepo?.length ? (
          <p className="text-xs text-stone-400">No data</p>
        ) : (
          <div className="space-y-2">
            {prStats.byRepo.map((r) => {
              const draftPct = r.draft > 0 ? (r.draft / repoMax) * 100 : 0;
              const readyPct = ((r.count - r.draft) / repoMax) * 100;
              return (
                <div key={r.repo} className="flex items-center gap-3">
                  <span className="text-xs text-stone-600 w-28 truncate shrink-0" title={r.repo}>{r.repo}</span>
                  <div className="flex-1 h-5 bg-stone-100 rounded overflow-hidden flex">
                    <div
                      className="h-full bg-accent/70 transition-all duration-300"
                      style={{ width: `${readyPct}%` }}
                    />
                    {r.draft > 0 && (
                      <div
                        className="h-full bg-stone-300 transition-all duration-300"
                        style={{ width: `${draftPct}%` }}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs font-medium text-stone-700 w-8 text-right tabular-nums">{r.count}</span>
                    {r.draft > 0 && (
                      <span className="flex items-center gap-0.5 text-stone-400">
                        <FileEdit className="w-3 h-3" />
                        <span className="text-[10px] font-semibold tabular-nums">{r.draft}</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
