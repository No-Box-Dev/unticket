/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GitPullRequest, GitMerge, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import { usePaginatedPrs } from "@/hooks/useGitHub";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";

function daysAgo(date: string): number {
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

export interface PrListFilter {
  state?: "open" | "closed" | "merged" | "all";
  repo?: string;
  author?: string;
  draft?: boolean;
  stale?: boolean;
  since?: string;
}

export interface PrListProps {
  title?: string;
  filter: PrListFilter;
  pageSize?: number;
  emptyMessage?: string;
  showRepoColumn?: boolean;
}

export function PrList({
  title,
  filter,
  pageSize = 30,
  emptyMessage = "No pull requests found",
  showRepoColumn = true,
}: PrListProps) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching } = usePaginatedPrs({
    state: filter.state,
    page,
    pageSize,
    repo: filter.repo,
    author: filter.author,
    draft: filter.draft,
    stale: filter.stale,
    since: filter.since,
  });

  const total = data?.totalCount ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      {(title || total > 0) && (
        <div className="flex items-center justify-between mb-3">
          {title && <h3 className="text-sm font-semibold text-stone-800">{title}</h3>}
          <span className="text-xs text-stone-400 ml-auto">{total} {total === 1 ? "PR" : "PRs"}</span>
        </div>
      )}

      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 text-left">
              <th className="px-4 py-2.5 text-xs font-medium text-stone-500">PR</th>
              <th className="px-4 py-2.5 text-xs font-medium text-stone-500">Title</th>
              <th className="px-4 py-2.5 text-xs font-medium text-stone-500">Author</th>
              <th className="px-4 py-2.5 text-xs font-medium text-stone-500">Reviewers</th>
              <th className="px-4 py-2.5 text-xs font-medium text-stone-500 text-right">Age</th>
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
            ) : total === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-stone-400">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              (data?.data ?? []).map((pr: any) => {
                const age = daysAgo(pr.created_at);
                const isStale = age > 7 && pr.state === "open";
                const repoName = pr.repo ?? pr.head?.repo?.name ?? "";
                const author = pr.user?.login ?? "";
                const isMerged = !!pr.merged_at;
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
                      "cursor-pointer hover:bg-stone-50 focus:bg-stone-50 focus:outline-none",
                      isStale && "bg-amber-50",
                    )}
                  >
                    <td className="px-4 py-2.5 text-stone-500 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {isMerged ? (
                          <GitMerge className="w-4 h-4 text-accent" />
                        ) : (
                          <GitPullRequest
                            className={cn("w-4 h-4", pr.draft ? "text-stone-400" : "text-green-600")}
                          />
                        )}
                        {showRepoColumn && repoName && (
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
                      {pr.head?.ref && pr.base?.ref && (
                        <div className="text-xs text-stone-400 truncate">
                          {pr.head.ref} → {pr.base.ref}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-stone-500">
                      {author ? (
                        <Link
                          to={`/prs/author/${author}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-accent hover:underline"
                        >
                          {author}
                        </Link>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-stone-500 text-xs">
                      {(pr.requested_reviewers ?? []).length > 0 ? (
                        (pr.requested_reviewers ?? []).map((r: any) => r.login).join(", ")
                      ) : (
                        <span className="text-stone-300">none</span>
                      )}
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
        <div className="mt-3 flex items-center justify-center gap-3">
          <button
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
            className="p-1 text-stone-400 hover:text-stone-600 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className={cn("text-xs text-stone-500 tabular-nums", isFetching && "opacity-50")}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(page + 1)}
            disabled={page >= totalPages}
            className="p-1 text-stone-400 hover:text-stone-600 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
