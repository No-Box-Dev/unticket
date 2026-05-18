/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useOpenPRs, useMergedPRs, usePRStats } from "@/hooks/useGitHub";
import { useFeedProjects } from "@/hooks/useNoxlink";
import { GitPullRequest, GitMerge, ExternalLink } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { PersonSelect } from "@/components/ui/PersonSelect";
import { cn } from "@/lib/cn";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { daysAgo, STALE_PR_DAYS } from "@/lib/dates";
import { SortIcon } from "@/components/ui/SortIcon";

type SortKey = "repo" | "title" | "author" | "age" | "reviewers";
type SortDir = "asc" | "desc";

const card = "bg-white  border border-stone-200  rounded-xl";

interface PRsTabProps {
  repoNames: string[];
  navFilter?: import("@/lib/types").NavFilter | null;
}

type PRView = "open" | "merged";

export function PRsTab({ repoNames, navFilter }: PRsTabProps) {
  const navigate = useNavigate();
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
  const { data: prStats, isLoading: prStatsLoading } = usePRStats();
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
    if (!byRepo?.length) return 50;
    return Math.max(...byRepo.map((r) => r.count), 50);
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
    <div className="space-y-6" data-tab="prs">
      {/* Open PRs by Repo */}
      <div className={cn(card, "p-5")}>
        <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wider mb-4">Open PRs by Repo</h3>
        {prStatsLoading ? (
          <div className="py-4"><Spinner className="mx-auto" /></div>
        ) : !prStats?.byRepo?.length ? (
          <p className="text-xs text-stone-400">No data</p>
        ) : (
          <div className="space-y-2">
            {prStats.byRepo.map((r) => {
              const ready = Math.max(0, r.count - r.draft);
              const draftPct = r.draft > 0 ? (r.draft / repoMax) * 100 : 0;
              const readyPct = (ready / repoMax) * 100;
              return (
                <Link
                  key={r.repo}
                  to={`/prs/repo/${r.repo}`}
                  className="flex items-center gap-3 -mx-2 px-2 py-0.5 rounded hover:bg-stone-50 group"
                  title={`Open PRs in ${r.repo}`}
                >
                  <span className="text-xs text-stone-600 w-28 truncate shrink-0 group-hover:text-accent" title={`${r.repo} — ${r.count} open`}>{r.repo}</span>
                  <div className="flex-1 h-5 bg-stone-100 rounded overflow-hidden flex">
                    {ready > 0 && (
                      <div
                        className="h-full bg-stone-400 transition-all duration-300"
                        style={{ width: `${readyPct}%` }}
                        title={`${ready} ready for review`}
                      />
                    )}
                    {r.draft > 0 && (
                      <div
                        className="h-full bg-stone-300 transition-all duration-300"
                        style={{ width: `${draftPct}%` }}
                        title={`${r.draft} draft`}
                      />
                    )}
                  </div>
                  <span className="text-xs font-medium text-stone-700 w-8 text-right tabular-nums shrink-0">{r.count}</span>
                </Link>
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

        <span className="text-xs text-stone-400 ml-auto flex items-center gap-1.5">
          {isLoading ? <Spinner size="sm" /> : `${sorted.length} of ${(prs ?? []).length} PRs`}
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
                const isStale = age > STALE_PR_DAYS;
                const repoName = pr.head.repo?.name ?? "";
                const onActivate = () => navigate(`/prs/${repoName}/${pr.number}`);
                return (
                  <tr
                    key={pr.id}
                    onClick={onActivate}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onActivate();
                      }
                    }}
                    tabIndex={0}
                    className={cn(
                      "hover:bg-stone-50 cursor-pointer focus:bg-stone-50 focus:outline-none",
                      isStale && "bg-amber-50",
                    )}
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
                        {repoName && (
                          <Link
                            to={`/prs/repo/${repoName}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:text-accent hover:underline"
                          >
                            {repoName}
                          </Link>
                        )}
                        #{pr.number}
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
                    <td className="px-4 py-2.5 text-stone-500">
                      {pr.user?.login ? (
                        <Link
                          to={`/prs/author/${pr.user.login}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-accent hover:underline"
                        >
                          {pr.user.login}
                        </Link>
                      ) : null}
                    </td>
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
                        onClick={(e) => e.stopPropagation()}
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
