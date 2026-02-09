import { CircleDot, CircleCheck, ExternalLink } from "lucide-react";
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
}

export function SprintIssuesTable({ openIssues, closedIssues, isLoading }: SprintIssuesTableProps) {
  const openCount = openIssues.length;
  const closedCount = closedIssues.length;

  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
        <span className="text-sm font-medium text-stone-700">
          Issues{" "}
          <span className="text-stone-400 font-normal">
            {openCount} open, {closedCount} closed
          </span>
        </span>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-100 text-left">
            <th className="px-3 py-2 text-xs font-medium text-stone-500 w-8"></th>
            <th className="px-3 py-2 text-xs font-medium text-stone-500">#</th>
            <th className="px-3 py-2 text-xs font-medium text-stone-500">Title</th>
            <th className="px-3 py-2 text-xs font-medium text-stone-500">Repo</th>
            <th className="px-3 py-2 text-xs font-medium text-stone-500">Assignee</th>
            <th className="px-3 py-2 text-xs font-medium text-stone-500 text-right">Age</th>
            <th className="px-3 py-2 w-6"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-50">
          {isLoading ? (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-stone-400">
                Loading issues...
              </td>
            </tr>
          ) : openIssues.length === 0 && closedIssues.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-stone-400">
                No issues found
              </td>
            </tr>
          ) : (
            <>
              {openIssues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} closed={false} />
              ))}
              {closedIssues.length > 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-2 text-[10px] font-medium text-stone-400 uppercase tracking-wider bg-stone-50"
                  >
                    Closed this sprint
                  </td>
                </tr>
              )}
              {closedIssues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} closed />
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

function IssueRow({ issue, closed }: { issue: SprintIssue; closed: boolean }) {
  const age = daysAgo(issue.created_at);
  return (
    <tr className={cn("hover:bg-stone-50", closed && "text-stone-400")}>
      <td className="px-3 py-2">
        {closed ? (
          <CircleCheck className="w-4 h-4 text-purple-500" />
        ) : (
          <CircleDot className="w-4 h-4 text-green-600" />
        )}
      </td>
      <td className="px-3 py-2 text-stone-500 whitespace-nowrap">#{issue.number}</td>
      <td className="px-3 py-2 max-w-xs truncate">{issue.title}</td>
      <td className="px-3 py-2 text-stone-500 text-xs">{issue.repo}</td>
      <td className="px-3 py-2 text-stone-500 text-xs">
        {issue.assignees.length > 0 ? issue.assignees.map((a) => a.login).join(", ") : "—"}
      </td>
      <td className={cn("px-3 py-2 text-right tabular-nums text-xs", age > 14 && !closed && "text-amber-600 font-medium")}>
        {age}d
      </td>
      <td className="px-3 py-2">
        <a href={issue.html_url} target="_blank" rel="noopener noreferrer" className="text-stone-300 hover:text-brand">
          <ExternalLink className="w-3 h-3" />
        </a>
      </td>
    </tr>
  );
}
