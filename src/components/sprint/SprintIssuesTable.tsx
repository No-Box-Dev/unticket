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

  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
        <span className="text-sm font-medium text-stone-700">Issues</span>
        <span className="text-xs text-stone-400">{openCount} open</span>
      </div>

      <div className="overflow-auto max-h-[400px]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 text-left">
              <th className="px-3 py-2 text-[10px] font-medium text-stone-400 uppercase tracking-wider">#</th>
              <th className="px-3 py-2 text-[10px] font-medium text-stone-400 uppercase tracking-wider">Title</th>
              <th className="px-3 py-2 text-[10px] font-medium text-stone-400 uppercase tracking-wider">Repo</th>
              <th className="px-3 py-2 text-[10px] font-medium text-stone-400 uppercase tracking-wider">Assignee</th>
              <th className="px-3 py-2 text-[10px] font-medium text-stone-400 uppercase tracking-wider text-right">Age</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-stone-400">
                  Loading issues...
                </td>
              </tr>
            ) : openIssues.length === 0 && closedIssues.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-stone-400">
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
                      colSpan={5}
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
    </div>
  );
}

function IssueRow({ issue, closed }: { issue: SprintIssue; closed: boolean }) {
  const age = daysAgo(issue.created_at);
  return (
    <tr
      className={cn("hover:bg-stone-50 cursor-pointer", closed && "text-stone-400")}
      onClick={() => window.open(issue.html_url, "_blank")}
    >
      <td className="px-3 py-2 text-stone-500 whitespace-nowrap">#{issue.number}</td>
      <td className="px-3 py-2 max-w-[280px] truncate">{issue.title}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5 text-xs text-stone-500">
          <span className={cn("w-2 h-2 rounded-full shrink-0", closed ? "bg-stone-300" : "bg-green-500")} />
          <span className="truncate max-w-[120px]">{issue.repo}</span>
        </span>
      </td>
      <td className="px-3 py-2 text-stone-500 text-xs">
        {issue.assignees.length > 0 ? issue.assignees.map((a) => a.login).join(", ") : "—"}
      </td>
      <td className={cn("px-3 py-2 text-right tabular-nums text-xs", age > 14 && !closed && "text-amber-600 font-medium")}>
        {age}d
      </td>
    </tr>
  );
}
