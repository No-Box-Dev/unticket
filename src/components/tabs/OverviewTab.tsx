import { GitPullRequest, CircleDot, FolderGit2, Clock } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { StatCard } from "@/components/StatCard";

function daysAgo(date: string): number {
  return Math.floor(
    (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24),
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface OverviewTabProps {
  repos: any[];
  prs: any[];
  issues: any[];
  prsLoading: boolean;
  issuesLoading: boolean;
}

export function OverviewTab({ repos, prs, issues, prsLoading, issuesLoading }: OverviewTabProps) {
  const stalePRs = prs.filter((pr) => daysAgo(pr.created_at) > 14);

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Repositories"
          value={repos.length}
          icon={<FolderGit2 className="w-5 h-5" />}
        />
        <StatCard
          label="Open PRs"
          value={prs.length}
          icon={<GitPullRequest className="w-5 h-5" />}
          loading={prsLoading}
        />
        <StatCard
          label="Open Issues"
          value={issues.length}
          icon={<CircleDot className="w-5 h-5" />}
          loading={issuesLoading}
        />
        <StatCard
          label="Stale PRs (14d+)"
          value={stalePRs.length}
          icon={<Clock className="w-5 h-5" />}
          loading={prsLoading}
        />
      </div>

      {/* Recent PRs */}
      <div className="bg-white rounded-xl border border-stone-200">
        <div className="px-4 py-3 border-b border-stone-100">
          <h2 className="text-sm font-semibold text-stone-900">Recent Pull Requests</h2>
        </div>
        <div className="divide-y divide-stone-100">
          {prsLoading ? (
            <div className="px-4 py-8 flex justify-center"><Spinner /></div>
          ) : prs.length === 0 ? (
            <div className="px-4 py-8 text-center text-stone-400 text-sm">No open PRs</div>
          ) : (
            prs.slice(0, 8).map((pr) => (
              <a
                key={pr.number}
                href={pr.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between px-4 py-2.5 hover:bg-stone-50 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <GitPullRequest className="w-4 h-4 text-green-600 shrink-0" />
                  <span className="text-xs text-stone-400 shrink-0">
                    {pr.head.repo?.name}#{pr.number}
                  </span>
                  <span className="text-sm text-stone-800 truncate">{pr.title}</span>
                  {pr.draft && (
                    <span className="text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded-full shrink-0">
                      draft
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <span className="text-xs text-stone-400">{pr.user?.login}</span>
                  <span className="text-xs text-stone-300">{daysAgo(pr.created_at)}d</span>
                </div>
              </a>
            ))
          )}
        </div>
      </div>

      {/* Recent Issues */}
      <div className="bg-white rounded-xl border border-stone-200">
        <div className="px-4 py-3 border-b border-stone-100">
          <h2 className="text-sm font-semibold text-stone-900">Recent Issues</h2>
        </div>
        <div className="divide-y divide-stone-100">
          {issuesLoading ? (
            <div className="px-4 py-8 flex justify-center"><Spinner /></div>
          ) : issues.length === 0 ? (
            <div className="px-4 py-8 text-center text-stone-400 text-sm">No open issues</div>
          ) : (
            issues.slice(0, 8).map((issue) => (
              <a
                key={issue.number}
                href={issue.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between px-4 py-2.5 hover:bg-stone-50 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <CircleDot className="w-4 h-4 text-green-600 shrink-0" />
                  <span className="text-sm text-stone-800 truncate">{issue.title}</span>
                  {(issue.labels ?? []).slice(0, 2).map((l: any) => (
                    <span
                      key={l.name}
                      className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: `#${l.color}20`,
                        color: `#${l.color}`,
                      }}
                    >
                      {l.name}
                    </span>
                  ))}
                </div>
                <span className="text-xs text-stone-300 shrink-0 ml-3">
                  {daysAgo(issue.created_at)}d
                </span>
              </a>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
