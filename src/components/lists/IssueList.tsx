/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CircleDot, CircleCheck, ExternalLink, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Flag } from "lucide-react";
import { usePaginatedIssues } from "@/hooks/useGitHub";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";

function daysAgo(date: string): number {
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

type SortKey = "number" | "title" | "repo" | "updated_at" | "created_at";

const CRITICAL_LABELS = new Set(["critical"]);
function isCritical(issue: any): boolean {
  return (issue.labels ?? []).some((l: any) => CRITICAL_LABELS.has(l.name?.toLowerCase()));
}

const labelColorMap: Record<string, { bg: string; text: string }> = {
  bug: { bg: "bg-red-50", text: "text-red-700" },
  enhancement: { bg: "bg-blue-50", text: "text-blue-700" },
  feature: { bg: "bg-blue-50", text: "text-blue-700" },
  investigation: { bg: "bg-yellow-50", text: "text-yellow-700" },
  documentation: { bg: "bg-accent-light", text: "text-accent" },
};

function getLabelStyle(name: string, color: string) {
  const key = name.toLowerCase();
  for (const [keyword, style] of Object.entries(labelColorMap)) {
    if (key.includes(keyword)) return style;
  }
  return { bg: `bg-[#${color}20]`, text: `text-[#${color}]` };
}

export interface IssueListFilter {
  state?: "open" | "closed" | "all";
  repo?: string;
  repos?: string[];
  assignee?: string | null; // null = unassigned
  label?: string;
  closedSince?: string;
  stale?: boolean;
}

export interface IssueListProps {
  title?: string;
  filter: IssueListFilter;
  pageSize?: number;
  emptyMessage?: string;
  defaultSort?: SortKey;
  defaultSortDir?: "asc" | "desc";
  showRepoColumn?: boolean;
}

export function IssueList({
  title,
  filter,
  pageSize = 30,
  emptyMessage = "No issues found",
  defaultSort = "updated_at",
  defaultSortDir = "desc",
  showRepoColumn = true,
}: IssueListProps) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>(defaultSort);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);

  const { data, isLoading, isFetching } = usePaginatedIssues({
    state: filter.state,
    page,
    pageSize,
    repos: filter.repos ?? (filter.repo ? [filter.repo] : undefined),
    assignee: filter.assignee ?? undefined,
    assigned: filter.assignee === null ? "false" : undefined,
    label: filter.label,
    closedSince: filter.closedSince,
    stale: filter.stale,
    sort: sortKey,
    sortDir,
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(1);
  };

  const total = data?.totalCount ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      {(title || total > 0) && (
        <div className="flex items-center justify-between mb-3">
          {title && <h3 className="text-sm font-semibold text-stone-800">{title}</h3>}
          <span className="text-xs text-stone-400 ml-auto">{total} {total === 1 ? "issue" : "issues"}</span>
        </div>
      )}

      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-stone-100 text-left">
              <th className="px-3 py-2 w-8"></th>
              <th
                onClick={() => toggleSort("number")}
                className="px-3 py-2 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700"
              >
                Issue <SortIcon column="number" activeKey={sortKey} activeDir={sortDir} />
              </th>
              <th
                onClick={() => toggleSort("title")}
                className="px-3 py-2 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700"
              >
                Title <SortIcon column="title" activeKey={sortKey} activeDir={sortDir} />
              </th>
              {showRepoColumn && (
                <th
                  onClick={() => toggleSort("repo")}
                  className="px-3 py-2 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700"
                >
                  Repo <SortIcon column="repo" activeKey={sortKey} activeDir={sortDir} />
                </th>
              )}
              <th className="px-3 py-2 text-xs font-medium text-stone-500">Labels</th>
              <th className="px-3 py-2 text-xs font-medium text-stone-500">Assignees</th>
              <th
                onClick={() => toggleSort("created_at")}
                className="px-3 py-2 text-xs font-medium text-stone-500 text-right cursor-pointer hover:text-stone-700"
              >
                Age <SortIcon column="created_at" activeKey={sortKey} activeDir={sortDir} />
              </th>
              <th className="px-3 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {isLoading ? (
              <tr>
                <td colSpan={showRepoColumn ? 8 : 7} className="px-4 py-8 text-center">
                  <Spinner className="mx-auto" />
                </td>
              </tr>
            ) : total === 0 ? (
              <tr>
                <td colSpan={showRepoColumn ? 8 : 7} className="px-4 py-8 text-center text-stone-400">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              (data?.data ?? []).map((issue: any) => {
                const age = daysAgo(issue.created_at);
                const closed = issue.state === "closed";
                const critical = !closed && isCritical(issue);
                const onActivate = () => navigate(`/issues/${issue.repo}/${issue.number}`);

                return (
                  <tr
                    key={issue.id}
                    onClick={onActivate}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onActivate();
                      }
                    }}
                    tabIndex={0}
                    className={cn(
                      "cursor-pointer hover:bg-stone-50 focus:bg-stone-50 focus:outline-none",
                      closed && "text-stone-400",
                      critical && "bg-red-50/50",
                    )}
                  >
                    <td className="px-3 py-2">
                      {closed ? (
                        <CircleCheck className="w-4 h-4 text-accent" />
                      ) : critical ? (
                        <Flag className="w-4 h-4 text-red-500" />
                      ) : (
                        <CircleDot className="w-4 h-4 text-green-600" />
                      )}
                    </td>
                    <td className="px-3 py-2 text-stone-500 whitespace-nowrap">#{issue.number}</td>
                    <td className="px-3 py-2 max-w-md truncate">{issue.title}</td>
                    {showRepoColumn && (
                      <td className="px-3 py-2 text-stone-500 text-xs">
                        <Link
                          to={`/issues/repo/${issue.repo}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-accent hover:underline"
                        >
                          {issue.repo}
                        </Link>
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <div className="flex gap-1 flex-wrap">
                        {(issue.labels ?? []).slice(0, 3).map((l: any) => {
                          const style = getLabelStyle(l.name, l.color);
                          return (
                            <Link
                              key={l.name}
                              to={`/issues/label/${encodeURIComponent(l.name)}`}
                              onClick={(e) => e.stopPropagation()}
                              className={cn(
                                "text-xs px-1.5 py-0.5 rounded-full font-medium hover:opacity-80",
                                style.bg,
                                style.text,
                              )}
                            >
                              {l.name}
                            </Link>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-stone-500 text-xs">
                      {(issue.assignees ?? []).length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {(issue.assignees as any[]).map((a) => (
                            <Link
                              key={a.login}
                              to={`/issues/assignee/${a.login}`}
                              onClick={(e) => e.stopPropagation()}
                              title={a.login}
                              className="inline-flex items-center"
                            >
                              {a.avatar_url ? (
                                <img
                                  src={a.avatar_url}
                                  alt={a.login}
                                  className="w-5 h-5 rounded-full ring-1 ring-stone-200"
                                />
                              ) : (
                                <span className="text-xs text-stone-500 hover:text-accent">{a.login}</span>
                              )}
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums",
                        age > 30 && !closed ? "text-amber-600 font-medium" : "text-stone-400",
                      )}
                    >
                      {age}d
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={issue.html_url}
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

      {totalPages > 1 && (
        <div className="mt-3">
          <PaginationControls
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            isFetching={isFetching}
          />
        </div>
      )}
    </div>
  );
}

function SortIcon({
  column,
  activeKey,
  activeDir,
}: {
  column: SortKey;
  activeKey: SortKey;
  activeDir: "asc" | "desc";
}) {
  if (activeKey !== column) return null;
  return activeDir === "asc" ? (
    <ChevronUp className="w-3 h-3 inline ml-0.5" />
  ) : (
    <ChevronDown className="w-3 h-3 inline ml-0.5" />
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
        className="p-1 text-stone-400 hover:text-stone-600 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className={cn("text-xs text-stone-500 tabular-nums", isFetching && "opacity-50")}>
        Page {page} of {totalPages}
      </span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="p-1 text-stone-400 hover:text-stone-600 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
