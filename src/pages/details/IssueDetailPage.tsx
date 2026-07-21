/* eslint-disable @typescript-eslint/no-explicit-any */
import { useParams, Link, Navigate } from "react-router-dom";
import Markdown from "react-markdown";
import { CircleDot, CircleCheck, ExternalLink, Flag } from "lucide-react";
import { useIssueDetail, useIssueBody } from "@/hooks/useGitHub";
import { useAuth } from "@/lib/auth";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import { daysAgo } from "@/lib/dates";
import { PageShell } from "./PageShell";

export function IssueDetailPage() {
  const { repo, number: numberStr } = useParams<{ repo: string; number: string }>();
  const { selectedOrg } = useAuth();
  const number = numberStr ? parseInt(numberStr, 10) : NaN;
  const isValidNumber = Number.isFinite(number) && number > 0;

  const { data: issue, isLoading, isError } = useIssueDetail(repo, isValidNumber ? number : undefined);
  const { data: body, isLoading: bodyLoading, isError: bodyError } = useIssueBody(
    repo,
    isValidNumber ? number : undefined,
  );

  if (!isValidNumber) return <Navigate to="/" replace />;

  return (
    <PageShell backTo="/?tab=issues" backLabel="Back to issues">
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Spinner className="w-6 h-6 text-accent" />
        </div>
      )}

      {!isLoading && (isError || !issue) && (
        <div className="text-center py-20">
          <p className="text-sm text-stone-500 mb-4">Couldn't load this issue.</p>
          {selectedOrg && repo && (
            <a
              href={`https://github.com/${selectedOrg}/${repo}/issues/${number}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
            >
              View on GitHub
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      )}

      {issue && (
        <article className="space-y-6">
          <header className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-stone-500">
              <span className="font-mono">#{issue.number}</span>
              <span>·</span>
              <Link to={`/issues/repo/${(issue as any).repo}`} className="hover:text-accent hover:underline">
                {(issue as any).repo}
              </Link>
              <span>·</span>
              <StatePill state={issue.state} />
            </div>
            <h1 className="text-2xl font-semibold text-stone-900 leading-snug">{issue.title}</h1>
            <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
              {issue.user && (
                <div className="flex items-center gap-1.5">
                  {issue.user.avatar_url && (
                    <img src={issue.user.avatar_url} alt="" className="w-5 h-5 rounded-full" />
                  )}
                  <span className="font-medium text-stone-700">{issue.user.login}</span>
                </div>
              )}
              <span>opened {daysAgo(issue.created_at)}d ago</span>
              {issue.state === "closed" && issue.closed_at && (
                <span>closed {daysAgo(issue.closed_at)}d ago</span>
              )}
            </div>
          </header>

          <MetadataRow issue={issue} />

          <section className="rounded-lg border border-stone-200 bg-white px-5 py-4 prose prose-sm prose-stone max-w-none">
            {bodyLoading ? (
              <div className="text-xs text-stone-400">Loading description…</div>
            ) : bodyError ? (
              <div className="text-xs text-stone-400">Couldn't load description.</div>
            ) : body?.body ? (
              <Markdown>{body.body}</Markdown>
            ) : (
              <span className="text-sm text-stone-400">No description.</span>
            )}
          </section>

          <footer className="flex items-center gap-3 text-xs text-stone-500">
            <a
              href={issue.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-accent"
            >
              View on GitHub
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            {body && body.comments > 0 && (
              <span>· {body.comments} comment{body.comments === 1 ? "" : "s"}</span>
            )}
          </footer>
        </article>
      )}
    </PageShell>
  );
}

function StatePill({ state }: { state: string }) {
  const closed = state === "closed";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        closed ? "bg-violet-50 text-violet-700" : "bg-green-50 text-green-700",
      )}
    >
      {closed ? <CircleCheck className="w-3 h-3" /> : <CircleDot className="w-3 h-3" />}
      {closed ? "Closed" : "Open"}
    </span>
  );
}

function MetadataRow({ issue }: { issue: any }) {
  const labels: { name: string; color: string }[] = issue.labels ?? [];
  const assignees: { login: string; avatar_url: string }[] = issue.assignees ?? [];
  const critical = labels.some((l) => l.name?.toLowerCase() === "critical");

  if (labels.length === 0 && assignees.length === 0 && !critical) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
      {critical && (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">
          <Flag className="w-3 h-3" />
          Critical
        </span>
      )}
      {labels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-stone-400 uppercase tracking-wider">Labels</span>
          {labels.map((l) => (
            <Link
              key={l.name}
              to={`/issues/label/${encodeURIComponent(l.name)}`}
              className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-700 hover:bg-stone-200"
              style={l.color ? { backgroundColor: `#${l.color}20`, color: `#${l.color}` } : undefined}
            >
              {l.name}
            </Link>
          ))}
        </div>
      )}
      {assignees.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-stone-400 uppercase tracking-wider">Assignees</span>
          <div className="flex -space-x-1.5">
            {assignees.map((a) => (
              <Link
                key={a.login}
                to={`/issues/assignee/${a.login}`}
                title={a.login}
                className="inline-block"
              >
                {a.avatar_url ? (
                  <img
                    src={a.avatar_url}
                    alt={a.login}
                    className="w-6 h-6 rounded-full ring-2 ring-white"
                  />
                ) : (
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-stone-200 text-[10px] font-medium text-stone-600 ring-2 ring-white">
                    {a.login.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
