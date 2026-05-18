/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  useFeedProjects,
  useBackfillProjectPrs,
  useSetProjectArchived,
  useFeedEvents,
} from "@/hooks/useNoxlink";
import { useAllPRs, useOpenIssues, useClosedIssues } from "@/hooks/useGitHub";
import { backfillProjectPrs } from "@/lib/noxlink-api";
import { useAuth } from "@/lib/auth";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Circle,
  CircleCheck,
  CircleDot,
  ExternalLink,
  GitCommit,
  GitMerge,
  GitPullRequest,
  Loader2,
  MessageSquare,
  Rocket,
  Sparkles,
  Tag,
  XCircle,
} from "lucide-react";
import type { BackfillResult, FeedEvent } from "@/lib/noxlink-api";

// ---------- Helpers ----------

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function renderBackfillStatus(r: BackfillResult): string {
  const parts: string[] = [];
  if (r.queued > 0) {
    parts.push(`Queued ${r.queued} PR${r.queued === 1 ? "" : "s"}`);
    if (r.skipped) parts.push(`${r.skipped} already done`);
  }
  if (r.renarrated > 0) {
    parts.push(`re-narrated ${r.renarrated} fallback post${r.renarrated === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) return r.message || `All ${r.found} PRs already backfilled.`;
  return parts.join(" · ") + ". Posts appear in the Feed shortly.";
}

// ---------- Types ----------

interface RepoSummary {
  id: string;
  name: string;
  org: string | null;
  repo: string | null;
  description: string | null;
  narrator_enabled: 0 | 1;
  archived: 0 | 1;
  openPRs: number;
  openIssues: number;
}

type ListPanelItem = {
  kind: "issue" | "pr";
  repo: string;
  number: number;
  title: string;
  html_url: string;
  timestamp: string;
  draft?: boolean;
};

type Category = "pr" | "review" | "issue" | "push" | "other";

type ActivityItem = {
  id: number;
  category: Category;
  type: string;
  label: string;
  number: number | null;
  title: string;
  to: string | null;
  html_url: string | null;
  at: string;
};

// ---------- Shared sub-components ----------

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-stone-400 uppercase tracking-wider">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-2xl font-bold font-display text-stone-800 mt-2 leading-none">{value}</div>
    </div>
  );
}

function CardStat({ label, value, loading }: { label: string; value: number | string; loading?: boolean }) {
  return (
    <div className="flex items-baseline gap-1">
      {loading ? (
        <Spinner size="sm" />
      ) : (
        <span className="text-sm font-semibold text-stone-800 font-display">{value}</span>
      )}
      <span className="text-[10px] uppercase tracking-wider text-stone-400">{label}</span>
    </div>
  );
}

function ItemListPanel({
  title,
  count,
  items,
  emptyMessage,
}: {
  title: string;
  count: number;
  items: ListPanelItem[];
  emptyMessage: string;
}) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl overflow-hidden flex flex-col">
      <div className="flex items-baseline justify-between px-4 py-3 border-b border-stone-100">
        <h3 className="text-[10px] font-medium text-stone-400 uppercase tracking-wider">{title}</h3>
        <span className="text-2xl font-bold font-display text-stone-800 leading-none">{count}</span>
      </div>
      {items.length === 0 ? (
        <div className="p-6 text-center text-sm text-stone-400">{emptyMessage}</div>
      ) : (
        <ol className="divide-y divide-stone-100 max-h-80 overflow-y-auto">
          {items.map((item) => {
            const to = item.kind === "issue"
              ? `/issues/${item.repo}/${item.number}`
              : `/prs/${item.repo}/${item.number}`;
            return (
              <li key={`${item.kind}:${item.repo}#${item.number}`}>
                <Link to={to} className="flex items-center gap-2 px-3 py-2 hover:bg-stone-50 group">
                  {item.kind === "pr" ? (
                    <GitPullRequest size={12} className={cn("shrink-0", item.draft ? "text-stone-400" : "text-green-600")} />
                  ) : (
                    <Circle size={12} className="text-stone-400 shrink-0" />
                  )}
                  <span className="text-[11px] text-stone-400 shrink-0 font-mono">#{item.number}</span>
                  <span className="text-xs text-stone-700 truncate flex-1">{item.title}</span>
                  <span className="text-[11px] text-stone-400 shrink-0">{formatRelative(item.timestamp)}</span>
                  <a
                    href={item.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-stone-300 opacity-0 group-hover:opacity-100 shrink-0 hover:text-accent"
                    title="Open on GitHub"
                  >
                    <ExternalLink size={11} />
                  </a>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ---------- Repo Card (grid view) ----------

function RepoCard({ repo, onSelect, statsLoading }: { repo: RepoSummary; onSelect: () => void; statsLoading?: boolean }) {
  const setArchived = useSetProjectArchived();
  const isArchived = !!repo.archived;

  const handleArchive = (e: React.MouseEvent) => {
    e.stopPropagation();
    setArchived.mutate({ id: repo.id, archived: !isArchived });
  };

  return (
    <div
      onClick={onSelect}
      className={cn(
        "bg-white border border-stone-200 rounded-xl p-4 text-left hover:border-stone-300 hover:bg-stone-50/50 transition-colors cursor-pointer flex flex-col gap-3",
        isArchived && "opacity-70",
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-lg bg-stone-100 shrink-0 flex items-center justify-center">
          <GitPullRequest size={16} className="text-stone-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-stone-900 truncate">{repo.repo || repo.name}</div>
          <div className="text-xs text-stone-400 truncate">{repo.org || repo.name}</div>
        </div>
      </div>

      {repo.description && (
        <p className="text-xs text-stone-500 line-clamp-1">{repo.description}</p>
      )}

      <div className="flex items-center gap-1 flex-wrap">
        {isArchived && (
          <span className="text-[10px] font-mono uppercase tracking-wide bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded">
            archived
          </span>
        )}
        {!isArchived && repo.narrator_enabled === 0 && (
          <span className="text-[10px] font-mono uppercase tracking-wide bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded">
            narrator off
          </span>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-stone-500">
          <CardStat label="Open PRs" value={repo.openPRs} loading={statsLoading} />
          <CardStat label="Issues" value={repo.openIssues} loading={statsLoading} />
        </div>
        <button
          type="button"
          onClick={handleArchive}
          disabled={setArchived.isPending}
          title={isArchived ? "Restore this repo" : "Archive this repo"}
          className="p-1 rounded text-stone-300 hover:text-stone-600 hover:bg-stone-100 transition-colors cursor-pointer"
        >
          {isArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
        </button>
      </div>
    </div>
  );
}

// ---------- Backfill All Button ----------

function BackfillAllButton({ activeProjects, days }: { activeProjects: RepoSummary[]; days: number }) {
  const qc = useQueryClient();
  const { selectedOrg } = useAuth();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string | null }>({
    done: 0,
    total: 0,
    current: null,
  });
  const [summary, setSummary] = useState<string | null>(null);

  const handleClick = async () => {
    if (activeProjects.length === 0 || running) return;
    setRunning(true);
    setSummary(null);
    setProgress({ done: 0, total: activeProjects.length, current: null });

    let queued = 0;
    let found = 0;
    let errors = 0;

    for (let i = 0; i < activeProjects.length; i++) {
      const p = activeProjects[i];
      setProgress({ done: i, total: activeProjects.length, current: p.repo ?? p.name });
      try {
        const r = await backfillProjectPrs(p.id, days);
        queued += r.queued ?? 0;
        found += r.found ?? 0;
      } catch {
        errors += 1;
      }
    }

    setProgress({ done: activeProjects.length, total: activeProjects.length, current: null });
    setSummary(
      `Queued ${queued} new post${queued === 1 ? "" : "s"} from ${found} PR${found === 1 ? "" : "s"}${errors ? ` · ${errors} error${errors === 1 ? "" : "s"}` : ""}.`,
    );
    setRunning(false);
    qc.invalidateQueries({ queryKey: ["noxlink", "events", selectedOrg] });
  };

  return (
    <div className="flex items-center gap-3">
      {summary && !running && <span className="text-xs text-stone-500">{summary}</span>}
      <button
        type="button"
        onClick={handleClick}
        disabled={running || activeProjects.length === 0}
        title={`Generate posts for the last ${days} day${days === 1 ? "" : "s"} of merged PRs across every active repo. Idempotent — already-backfilled PRs are skipped.`}
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-medium transition-colors cursor-pointer",
          running
            ? "bg-stone-100 text-stone-500 cursor-not-allowed"
            : "bg-stone-700 text-white hover:bg-stone-900 disabled:opacity-50",
        )}
      >
        {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        {running
          ? `${progress.current ?? ""} (${progress.done}/${progress.total})`
          : `Backfill all ${activeProjects.length} repo${activeProjects.length === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}

// ---------- Detail view action buttons ----------

function DetailBackfillButton({ project, days }: { project: RepoSummary; days: number }) {
  const backfill = useBackfillProjectPrs();
  const [result, setResult] = useState<BackfillResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handleBackfill = async () => {
    setResult(null);
    setErr(null);
    try {
      const r = await backfill.mutateAsync({ id: project.id, days });
      setResult(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Backfill failed");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleBackfill}
        disabled={backfill.isPending}
        title={`Generate posts for the last ${days} days of merged PRs.`}
        className={cn(
          "px-3 py-1.5 text-xs rounded-lg font-medium transition-colors cursor-pointer",
          backfill.isPending
            ? "bg-stone-100 text-stone-400 cursor-not-allowed"
            : "bg-stone-700 text-white hover:bg-stone-900",
        )}
      >
        {backfill.isPending ? "Backfilling…" : "Backfill"}
      </button>
      {result && <span className="text-xs text-stone-400">{renderBackfillStatus(result)}</span>}
      {err && <span className="text-xs text-severity-high">{err}</span>}
    </div>
  );
}

function DetailArchiveButton({ project }: { project: RepoSummary }) {
  const setArchived = useSetProjectArchived();
  const isArchived = !!project.archived;

  return (
    <button
      type="button"
      onClick={() => setArchived.mutate({ id: project.id, archived: !isArchived })}
      disabled={setArchived.isPending}
      title={isArchived ? "Restore this repo" : "Archive this repo"}
      className={cn(
        "p-1.5 rounded-md transition-colors cursor-pointer",
        setArchived.isPending
          ? "text-stone-300 cursor-not-allowed"
          : "text-stone-400 hover:text-stone-700 hover:bg-stone-100",
      )}
    >
      {isArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
    </button>
  );
}

// ---------- Activity Feed (project-based) ----------

const FILTER_BUTTONS: Array<{ id: "all" | Category; label: string }> = [
  { id: "all", label: "All" },
  { id: "pr", label: "PRs" },
  { id: "review", label: "Reviews" },
  { id: "issue", label: "Issues" },
  { id: "push", label: "Pushes" },
  { id: "other", label: "Other" },
];

function RepoActivityFeed({ projectId }: { projectId: string }) {
  const events = useFeedEvents({ projectId, limit: 100 });

  const items = useMemo<ActivityItem[]>(
    () => (events.data ?? []).map(buildActivityItem).filter((x): x is ActivityItem => x !== null),
    [events.data],
  );

  const [filter, setFilter] = useState<"all" | Category>("all");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length, pr: 0, review: 0, issue: 0, push: 0, other: 0 };
    for (const it of items) c[it.category] = (c[it.category] ?? 0) + 1;
    return c;
  }, [items]);

  const visible = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.category === filter)),
    [items, filter],
  );

  return (
    <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-status-production" />
          <h3 className="text-sm font-semibold text-stone-700">Activity</h3>
          <span className="text-xs text-stone-400">last {items.length} events</span>
        </div>
        <div className="flex items-center gap-1 text-xs flex-wrap">
          {FILTER_BUTTONS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={cn(
                "px-2 py-1 rounded transition-colors cursor-pointer",
                filter === id ? "bg-accent/10 text-accent" : "text-stone-500 hover:bg-stone-100",
              )}
            >
              {label} ({counts[id] ?? 0})
            </button>
          ))}
        </div>
      </div>

      {events.isLoading ? (
        <div className="p-6 text-center"><Spinner className="w-5 h-5 text-accent inline-block" /></div>
      ) : visible.length === 0 ? (
        <div className="p-6 text-center text-sm text-stone-400">No activity recorded.</div>
      ) : (
        <ol className="divide-y divide-stone-100 max-h-[420px] overflow-y-auto">
          {visible.map((item) => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </ol>
      )}
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const content = (
    <>
      <ActivityIcon type={item.type} />
      <span className="text-xs text-stone-400 shrink-0 font-mono">
        {item.number != null ? `#${item.number}` : "—"}
      </span>
      <span className="text-sm text-stone-700 truncate flex-1">{item.title}</span>
      <span className="text-xs text-stone-400 shrink-0">{item.label}</span>
      <span className="text-xs text-stone-400 shrink-0 w-16 text-right">{formatRelative(item.at)}</span>
      {item.html_url ? (
        <a
          href={item.html_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-stone-300 opacity-0 group-hover:opacity-100 shrink-0 hover:text-accent"
          title="Open on GitHub"
        >
          <ExternalLink size={12} />
        </a>
      ) : (
        <span className="w-3 shrink-0" />
      )}
    </>
  );

  const className = "flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50 group";
  return (
    <li>
      {item.to ? (
        <Link to={item.to} className={className}>{content}</Link>
      ) : (
        <div className={className}>{content}</div>
      )}
    </li>
  );
}

function ActivityIcon({ type }: { type: string }) {
  const cls = "shrink-0";
  if (type === "github:pr:merged") return <GitMerge size={14} className={cn(cls, "text-purple-500")} />;
  if (type === "github:pr:review:approved") return <CircleCheck size={14} className={cn(cls, "text-green-600")} />;
  if (type === "github:pr:review:changes_requested") return <XCircle size={14} className={cn(cls, "text-red-500")} />;
  if (type.startsWith("github:pr:review:")) return <MessageSquare size={14} className={cn(cls, "text-stone-400")} />;
  if (type.startsWith("github:pr:")) return <GitPullRequest size={14} className={cn(cls, "text-stone-400")} />;
  if (type === "github:issue:closed") return <CircleCheck size={14} className={cn(cls, "text-stone-400")} />;
  if (type.startsWith("github:issue:")) return <Circle size={14} className={cn(cls, "text-stone-400")} />;
  if (type === "github:push") return <GitCommit size={14} className={cn(cls, "text-stone-400")} />;
  if (type === "github:release:published") return <Rocket size={14} className={cn(cls, "text-stone-400")} />;
  return <Tag size={14} className={cn(cls, "text-stone-400")} />;
}

function buildActivityItem(e: FeedEvent): ActivityItem | null {
  const label = activityLabelForType(e.type);
  if (!label) return null;

  const category = activityCategoryForType(e.type);
  const payload = parsePayload(e.payload_json);
  const number = extractActivityNumber(e, payload);
  const title = extractActivityTitle(e, payload);
  const repo = e.repo;
  const org = e.org;

  let to: string | null = null;
  let html_url: string | null = null;

  if (repo && number != null) {
    if (category === "issue") {
      to = `/issues/${repo}/${number}`;
      if (org) html_url = `https://github.com/${org}/${repo}/issues/${number}`;
    } else if (category === "pr" || category === "review") {
      to = `/prs/${repo}/${number}`;
      if (org) html_url = `https://github.com/${org}/${repo}/pull/${number}`;
    }
  }

  if (e.type === "github:push" && org && repo && payload?.after) {
    html_url = `https://github.com/${org}/${repo}/commit/${payload.after}`;
  }

  return { id: e.id, category, type: e.type, label, number, title, to, html_url, at: e.created_at };
}

function activityCategoryForType(type: string): Category {
  if (type.startsWith("github:pr:review:")) return "review";
  if (type.startsWith("github:pr:")) return "pr";
  if (type.startsWith("github:issue:")) return "issue";
  if (type === "github:push") return "push";
  return "other";
}

function activityLabelForType(type: string): string | null {
  switch (type) {
    case "github:pr:opened": return "opened PR";
    case "github:pr:merged": return "merged PR";
    case "github:pr:closed": return "closed PR";
    case "github:pr:reopened": return "reopened PR";
    case "github:pr:review:approved": return "approved";
    case "github:pr:review:changes_requested": return "requested changes";
    case "github:pr:review:commented": return "reviewed";
    case "github:issue:opened": return "opened issue";
    case "github:issue:closed": return "closed issue";
    case "github:push": return "pushed";
    case "github:release:published": return "released";
    default: return null;
  }
}

function parsePayload(raw: string | null): any {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function extractActivityNumber(e: FeedEvent, payload: any): number | null {
  const fromPayload = payload?.pr?.number ?? payload?.issue?.number;
  if (typeof fromPayload === "number") return fromPayload;
  const m = e.summary?.match(/#(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function extractActivityTitle(e: FeedEvent, payload: any): string {
  const fromPayload = payload?.pr?.title ?? payload?.issue?.title;
  if (fromPayload) return fromPayload;
  if (!e.summary) return "—";
  const stripped = e.summary.replace(/^[^:]+:\s*/, "");
  return stripped || e.summary;
}

// ---------- Repo PRs sub-page ----------

function RepoPrsSubPage({
  repoName,
  onBack,
  openPRs,
  mergedPRs,
}: {
  repoName: string;
  onBack: () => void;
  openPRs: ListPanelItem[];
  mergedPRs: ListPanelItem[];
}) {
  const [view, setView] = useState<"open" | "merged">("open");
  const items = view === "open" ? openPRs : mergedPRs;

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        {repoName}
      </button>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-900 font-display">PRs</h2>
        <div className="flex items-center rounded-lg border border-stone-200 overflow-hidden">
          <button
            onClick={() => setView("open")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
              view === "open" ? "bg-stone-800 text-white" : "bg-white text-stone-500 hover:bg-stone-50",
            )}
          >
            Open ({openPRs.length})
          </button>
          <button
            onClick={() => setView("merged")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer border-l border-stone-200",
              view === "merged" ? "bg-stone-800 text-white" : "bg-white text-stone-500 hover:bg-stone-50",
            )}
          >
            Merged ({mergedPRs.length})
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-xl p-10 text-center text-sm text-stone-400">
          No {view === "open" ? "open" : "merged"} PRs.
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
          <ol className="divide-y divide-stone-100">
            {items.map((item) => (
              <li key={`pr:${item.repo}#${item.number}`}>
                <Link to={`/prs/${item.repo}/${item.number}`} className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50 group">
                  <GitPullRequest size={14} className={cn("shrink-0", item.draft ? "text-stone-400" : "text-green-600")} />
                  <span className="text-xs text-stone-400 shrink-0 font-mono">#{item.number}</span>
                  <span className="text-sm text-stone-700 truncate flex-1">{item.title}</span>
                  <span className="text-xs text-stone-400 shrink-0">{formatRelative(item.timestamp)}</span>
                  <a
                    href={item.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-stone-300 opacity-0 group-hover:opacity-100 shrink-0 hover:text-accent"
                    title="Open on GitHub"
                  >
                    <ExternalLink size={12} />
                  </a>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ---------- Repo Issues sub-page ----------

function RepoIssuesSubPage({
  repoName,
  onBack,
  openIssues,
  closedIssues,
}: {
  repoName: string;
  onBack: () => void;
  openIssues: ListPanelItem[];
  closedIssues: ListPanelItem[];
}) {
  const [view, setView] = useState<"open" | "closed">("open");
  const items = view === "open" ? openIssues : closedIssues;

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        {repoName}
      </button>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-900 font-display">Issues</h2>
        <div className="flex items-center rounded-lg border border-stone-200 overflow-hidden">
          <button
            onClick={() => setView("open")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
              view === "open" ? "bg-stone-800 text-white" : "bg-white text-stone-500 hover:bg-stone-50",
            )}
          >
            Open ({openIssues.length})
          </button>
          <button
            onClick={() => setView("closed")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer border-l border-stone-200",
              view === "closed" ? "bg-stone-800 text-white" : "bg-white text-stone-500 hover:bg-stone-50",
            )}
          >
            Closed ({closedIssues.length})
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-xl p-10 text-center text-sm text-stone-400">
          No {view === "open" ? "open" : "closed"} issues.
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
          <ol className="divide-y divide-stone-100">
            {items.map((item) => (
              <li key={`issue:${item.repo}#${item.number}`}>
                <Link to={`/issues/${item.repo}/${item.number}`} className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50 group">
                  {view === "open" ? (
                    <Circle size={14} className="text-stone-400 shrink-0" />
                  ) : (
                    <CircleCheck size={14} className="text-stone-400 shrink-0" />
                  )}
                  <span className="text-xs text-stone-400 shrink-0 font-mono">#{item.number}</span>
                  <span className="text-sm text-stone-700 truncate flex-1">{item.title}</span>
                  <span className="text-xs text-stone-400 shrink-0">{formatRelative(item.timestamp)}</span>
                  <a
                    href={item.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-stone-300 opacity-0 group-hover:opacity-100 shrink-0 hover:text-accent"
                    title="Open on GitHub"
                  >
                    <ExternalLink size={12} />
                  </a>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ---------- Main Component ----------

export function ReposTab({ repoNames }: { repoNames: string[] }) {
  const projects = useFeedProjects();
  const { data: allPRs, isLoading: allPRsLoading } = useAllPRs(repoNames);
  const { data: openIssues, isLoading: openIssuesLoading } = useOpenIssues(repoNames);
  const { data: closedIssues } = useClosedIssues(repoNames);
  const statsLoading = allPRsLoading || openIssuesLoading;

  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [subPage, setSubPage] = useState<"prs" | "issues" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [days, setDays] = useState(3);

  const repos = useMemo<RepoSummary[]>(() => {
    const list = projects.data ?? [];
    return list.map((p) => ({
      id: p.id,
      name: p.name,
      org: p.org,
      repo: p.repo,
      description: p.description,
      narrator_enabled: p.narrator_enabled,
      archived: p.archived,
      openPRs: allPRs?.filter((pr: any) => pr.repo === p.repo && pr.state === "open")?.length ?? 0,
      openIssues: openIssues?.filter((i: any) => i.repo === p.repo)?.length ?? 0,
    }));
  }, [projects.data, allPRs, openIssues]);

  const active = useMemo(
    () =>
      repos
        .filter((r) => !r.archived)
        .sort((a, b) => {
          const ax = a.openPRs + a.openIssues;
          const bx = b.openPRs + b.openIssues;
          if (bx !== ax) return bx - ax;
          return (a.repo || a.name).localeCompare(b.repo || b.name);
        }),
    [repos],
  );

  const archived = useMemo(
    () => repos.filter((r) => !!r.archived).sort((a, b) => (a.repo || a.name).localeCompare(b.repo || b.name)),
    [repos],
  );

  const selected = useMemo(
    () => (selectedRepo ? repos.find((r) => (r.repo ?? r.name) === selectedRepo) ?? null : null),
    [selectedRepo, repos],
  );

  const detailOpenPRs = useMemo<ListPanelItem[]>(() => {
    if (!selected?.repo) return [];
    return (allPRs ?? [])
      .filter((pr: any) => pr.repo === selected.repo && pr.state === "open")
      .map((pr: any) => ({
        kind: "pr" as const,
        repo: pr.repo,
        number: pr.number,
        title: pr.title,
        html_url: pr.html_url,
        timestamp: pr.updated_at ?? pr.created_at,
        draft: pr.draft,
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [selected, allPRs]);

  const detailOpenIssues = useMemo<ListPanelItem[]>(() => {
    if (!selected?.repo) return [];
    return (openIssues ?? [])
      .filter((i: any) => i.repo === selected.repo)
      .map((i: any) => ({
        kind: "issue" as const,
        repo: i.repo,
        number: i.number,
        title: i.title,
        html_url: i.html_url,
        timestamp: i.updated_at,
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [selected, openIssues]);

  const mergedCount = useMemo(() => {
    if (!selected?.repo) return 0;
    return (allPRs ?? []).filter((pr: any) => pr.repo === selected.repo && pr.merged_at).length;
  }, [selected, allPRs]);

  const closedCount = useMemo(() => {
    if (!selected?.repo) return 0;
    return (closedIssues ?? []).filter((i: any) => i.repo === selected.repo).length;
  }, [selected, closedIssues]);

  const detailMergedPRs = useMemo<ListPanelItem[]>(() => {
    if (!selected?.repo) return [];
    return (allPRs ?? [])
      .filter((pr: any) => pr.repo === selected.repo && pr.merged_at)
      .map((pr: any) => ({
        kind: "pr" as const,
        repo: pr.repo,
        number: pr.number,
        title: pr.title,
        html_url: pr.html_url,
        timestamp: pr.merged_at ?? pr.updated_at ?? pr.created_at,
        draft: pr.draft,
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [selected, allPRs]);

  const detailClosedIssues = useMemo<ListPanelItem[]>(() => {
    if (!selected?.repo) return [];
    return (closedIssues ?? [])
      .filter((i: any) => i.repo === selected.repo)
      .map((i: any) => ({
        kind: "issue" as const,
        repo: i.repo,
        number: i.number,
        title: i.title,
        html_url: i.html_url,
        timestamp: i.closed_at ?? i.updated_at,
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [selected, closedIssues]);

  // Loading / error / empty
  if (projects.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="w-6 h-6 text-accent" />
      </div>
    );
  }

  if (projects.isError) {
    return <div className="text-center py-20 text-stone-400">Failed to load repos.</div>;
  }

  if (repos.length === 0) {
    return (
      <div className="bg-white border border-stone-200 rounded-xl p-10 text-center text-stone-400">
        No repos yet. Make sure the GitHub App is installed; repos populate from the install on first load.
      </div>
    );
  }

  // ---- Grid view ----
  if (!selectedRepo) {
    return (
      <div className="space-y-2">
        <header className="flex items-center justify-between gap-3 px-1">
          <div className="flex items-baseline gap-3">
            <h2 className="text-lg font-semibold text-stone-900 font-display">Repos</h2>
            <span className="text-xs text-stone-500">
              {active.length} active{archived.length > 0 ? ` · ${archived.length} archived` : ""}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-stone-600 flex items-center gap-2">
              Days:
              <input
                type="number"
                min={1}
                max={30}
                value={days}
                onChange={(e) => setDays(Math.max(1, Math.min(30, Number(e.target.value) || 3)))}
                className="w-14 px-2 py-1 rounded border border-stone-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
              />
            </label>
            <BackfillAllButton activeProjects={active} days={days} />
          </div>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {active.map((r) => (
            <RepoCard key={r.id} repo={r} onSelect={() => setSelectedRepo(r.repo ?? r.name)} statsLoading={statsLoading} />
          ))}
        </div>

        {archived.length > 0 && (
          <div className="pt-4">
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="text-xs text-stone-500 hover:text-stone-800 cursor-pointer px-1"
            >
              {showArchived ? "Hide" : "Show"} archived ({archived.length})
            </button>
            {showArchived && (
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {archived.map((r) => (
                  <RepoCard key={r.id} repo={r} onSelect={() => setSelectedRepo(r.repo ?? r.name)} statsLoading={statsLoading} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ---- Detail view ----
  if (!selected) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => { setSelectedRepo(null); setSubPage(null); }}
          className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          All repos
        </button>
        <div className="text-center py-20 text-stone-400">Repo not found.</div>
      </div>
    );
  }

  const ghUrl = selected.org && selected.repo
    ? `https://github.com/${selected.org}/${selected.repo}`
    : null;

  // ---- Sub-page: PRs ----
  if (subPage === "prs") {
    const [openPRs, mergedPRs] = [detailOpenPRs, detailMergedPRs];
    return (
      <RepoPrsSubPage
        repoName={selected.repo || selected.name}
        onBack={() => setSubPage(null)}
        openPRs={openPRs}
        mergedPRs={mergedPRs}
      />
    );
  }

  // ---- Sub-page: Issues ----
  if (subPage === "issues") {
    return (
      <RepoIssuesSubPage
        repoName={selected.repo || selected.name}
        onBack={() => setSubPage(null)}
        openIssues={detailOpenIssues}
        closedIssues={detailClosedIssues}
      />
    );
  }

  return (
    <div className="space-y-4">
      <button
        onClick={() => { setSelectedRepo(null); setSubPage(null); }}
        className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        All repos
      </button>

      {/* Header */}
      <div className="bg-white border border-stone-200 rounded-xl p-5 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-stone-900 font-display truncate">
            {selected.repo || selected.name}
          </h2>
          {selected.org && <p className="text-sm text-stone-400 truncate">{selected.org}</p>}
          {selected.description && (
            <p className="text-sm text-stone-500 mt-0.5 line-clamp-2">{selected.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {selected.repo && (
            <>
              <Link
                to={`/issues/repo/${selected.repo}`}
                className="p-1.5 rounded-md text-stone-400 hover:text-accent hover:bg-stone-100 transition-colors"
                title={`Open issues in ${selected.repo}`}
              >
                <CircleDot className="w-3.5 h-3.5" />
              </Link>
              <Link
                to={`/prs/repo/${selected.repo}`}
                className="p-1.5 rounded-md text-stone-400 hover:text-accent hover:bg-stone-100 transition-colors"
                title={`Open PRs in ${selected.repo}`}
              >
                <GitPullRequest className="w-3.5 h-3.5" />
              </Link>
            </>
          )}
          {ghUrl && (
            <a
              href={ghUrl}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
              title="Open on GitHub"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <DetailBackfillButton project={selected} days={days} />
          <DetailArchiveButton project={selected} />
        </div>
      </div>

      {/* Quick stats (inline, matching grid card style) */}
      <div className="bg-white border border-stone-200 rounded-xl px-4 py-3 flex items-center gap-6">
        <button type="button" onClick={() => setSubPage("prs")} className="cursor-pointer hover:opacity-70 transition-opacity">
          <CardStat label="Open PRs" value={detailOpenPRs.length} />
        </button>
        <button type="button" onClick={() => setSubPage("issues")} className="cursor-pointer hover:opacity-70 transition-opacity">
          <CardStat label="Open Issues" value={detailOpenIssues.length} />
        </button>
        <CardStat label="Merged PRs" value={mergedCount} />
        <CardStat label="Closed Issues" value={closedCount} />
      </div>

      {/* Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="cursor-pointer" onClick={() => setSubPage("prs")}>
          <ItemListPanel title="Open PRs" count={detailOpenPRs.length} items={detailOpenPRs} emptyMessage="No open PRs." />
        </div>
        <div className="cursor-pointer" onClick={() => setSubPage("issues")}>
          <ItemListPanel title="Open Issues" count={detailOpenIssues.length} items={detailOpenIssues} emptyMessage="No open issues." />
        </div>
      </div>

      {/* Activity Feed */}
      <RepoActivityFeed projectId={selected.id} />

      {/* Lifetime stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Open Issues" value={detailOpenIssues.length} icon={<Circle size={14} className="text-stone-400" />} />
        <StatCard label="Open PRs" value={detailOpenPRs.length} icon={<GitPullRequest size={14} className="text-stone-400" />} />
        <StatCard label="Merged PRs" value={mergedCount} icon={<GitMerge size={14} className="text-stone-400" />} />
        <StatCard label="Closed Issues" value={closedCount} icon={<CircleCheck size={14} className="text-stone-400" />} />
      </div>
    </div>
  );
}
