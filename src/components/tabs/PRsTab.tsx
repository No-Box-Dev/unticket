import { useState, useMemo } from "react";
import { useOpenPRs } from "@/hooks/useGitHub";
import { GitPullRequest, ExternalLink, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

function daysAgo(date: string): number {
  return Math.floor(
    (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24),
  );
}

type SortKey = "repo" | "title" | "author" | "age" | "reviewers";
type SortDir = "asc" | "desc";

interface PRsTabProps {
  repoNames: string[];
}

export function PRsTab({ repoNames }: PRsTabProps) {
  const { data: prs, isLoading } = useOpenPRs(repoNames);
  const [personFilter, setPersonFilter] = useState<string>("all");
  const [repoFilter, setRepoFilter] = useState<string>("all");
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
    if (personFilter !== "all") {
      list = list.filter((pr: any) => pr.user?.login === personFilter);
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

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortDir === "asc" ? (
      <ChevronUp className="w-3 h-3 inline ml-0.5" />
    ) : (
      <ChevronDown className="w-3 h-3 inline ml-0.5" />
    );
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={personFilter}
          onChange={(e) => setPersonFilter(e.target.value)}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-stone-200 text-stone-600 cursor-pointer focus:outline-none focus:border-brand"
        >
          <option value="all">All Authors</option>
          {authors.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        <select
          value={repoFilter}
          onChange={(e) => setRepoFilter(e.target.value)}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-stone-200 text-stone-600 cursor-pointer focus:outline-none focus:border-brand"
        >
          <option value="all">All Repos</option>
          {repos.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>

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
                PR <SortIcon col="repo" />
              </th>
              <th
                onClick={() => toggleSort("title")}
                className="px-4 py-2.5 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700"
              >
                Title <SortIcon col="title" />
              </th>
              <th
                onClick={() => toggleSort("author")}
                className="px-4 py-2.5 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700"
              >
                Author <SortIcon col="author" />
              </th>
              <th
                onClick={() => toggleSort("reviewers")}
                className="px-4 py-2.5 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700"
              >
                Reviewers <SortIcon col="reviewers" />
              </th>
              <th
                onClick={() => toggleSort("age")}
                className="px-4 py-2.5 text-xs font-medium text-stone-500 text-right cursor-pointer hover:text-stone-700"
              >
                Age <SortIcon col="age" />
              </th>
              <th className="px-4 py-2.5 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-stone-400">
                  Loading pull requests...
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
                return (
                  <tr
                    key={pr.id}
                    className={cn("hover:bg-stone-50", isStale && "bg-amber-50")}
                  >
                    <td className="px-4 py-2.5 text-stone-500 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <GitPullRequest
                          className={cn(
                            "w-4 h-4",
                            pr.draft ? "text-stone-400" : "text-green-600",
                          )}
                        />
                        {pr.head.repo?.name}#{pr.number}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 max-w-md">
                      <div className="text-stone-800 truncate">
                        {pr.title}
                        {pr.draft && (
                          <span className="ml-2 text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded-full">
                            draft
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-stone-400 truncate">
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
                        isStale ? "text-amber-600 font-medium" : "text-stone-400",
                      )}
                    >
                      {age}d
                    </td>
                    <td className="px-4 py-2.5">
                      <a
                        href={pr.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-stone-300 hover:text-brand"
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
