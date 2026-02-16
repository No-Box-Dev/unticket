import { useState } from "react";
import { cn } from "@/lib/cn";

function daysAgo(date: string): number {
  return Math.floor(
    (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24),
  );
}

interface SprintIssue {
  id: number;
  number: number;
  title: string;
  state: string;
  created_at: string;
  closed_at?: string | null;
  user: { login: string } | null;
  assignees: { login: string }[];
  labels: { name: string; color: string }[];
  html_url: string;
  repo: string;
}

interface SprintIssuesTableProps {
  openIssues: SprintIssue[];
  closedIssues: SprintIssue[];
  isLoading: boolean;
  limit?: number;
  sprintStart?: string;
}

export function SprintIssuesTable({ openIssues, closedIssues, isLoading, limit, sprintStart }: SprintIssuesTableProps) {
  const [view, setView] = useState<"open" | "closed">("open");

  const filteredClosed = sprintStart
    ? closedIssues.filter((i) => i.closed_at && new Date(i.closed_at) >= new Date(sprintStart))
    : closedIssues;

  const activeIssues = view === "open" ? openIssues : filteredClosed;
  const shown = limit ? activeIssues.slice(0, limit) : activeIssues;
  const hidden = activeIssues.length - shown.length;

  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-stone-100">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-stone-700">Issues</span>
          <div className="flex rounded-md border border-stone-200 overflow-hidden text-xs">
            <button
              className={cn(
                "px-2.5 py-1 transition-colors",
                view === "open"
                  ? "bg-stone-800 text-white"
                  : "bg-white text-stone-500 hover:bg-stone-50",
              )}
              onClick={() => setView("open")}
            >
              Open ({openIssues.length})
            </button>
            <button
              className={cn(
                "px-2.5 py-1 transition-colors border-l border-stone-200",
                view === "closed"
                  ? "bg-stone-800 text-white"
                  : "bg-white text-stone-500 hover:bg-stone-50",
              )}
              onClick={() => setView("closed")}
            >
              Closed ({filteredClosed.length})
            </button>
          </div>
        </div>
      </div>

      <div className="max-h-[400px] overflow-y-auto">
        <div className="min-w-0">
          {isLoading ? (
            <div className="px-3 py-6 text-center text-stone-400 text-sm">
              Loading issues...
            </div>
          ) : activeIssues.length === 0 ? (
            <div className="px-3 py-6 text-center text-stone-400 text-sm">
              No {view} issues found
            </div>
          ) : (
            <div className="divide-y divide-stone-50">
              {shown.map((issue) => (
                <IssueRow key={issue.id} issue={issue} closed={view === "closed"} />
              ))}
              {hidden > 0 && (
                <div className="px-3 py-1.5 text-xs text-stone-400 text-center">
                  +{hidden} more {view}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function IssueRow({ issue, closed }: { issue: SprintIssue; closed: boolean }) {
  const age = daysAgo(issue.created_at);
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2 hover:bg-stone-50 cursor-pointer text-sm",
        closed && "text-stone-400",
      )}
      onClick={() => window.open(issue.html_url, "_blank")}
    >
      <span className="text-stone-500 shrink-0 w-12 text-xs">#{issue.number}</span>
      <span className="truncate flex-1 min-w-0">{issue.title}</span>
      <span className="shrink-0 flex items-center gap-1.5 text-xs text-stone-500">
        <span className={cn("w-2 h-2 rounded-full", closed ? "bg-stone-300" : "bg-green-500")} />
        <span className="truncate max-w-[100px]">{issue.repo}</span>
      </span>
      <span className="shrink-0 w-20 text-stone-500 text-xs truncate text-right">
        {issue.assignees.length > 0 ? issue.assignees.map((a) => a.login).join(", ") : "—"}
      </span>
      <span className={cn("shrink-0 w-8 text-right tabular-nums text-xs", age > 14 && !closed && "text-amber-600 font-medium")}>
        {age}d
      </span>
    </div>
  );
}
