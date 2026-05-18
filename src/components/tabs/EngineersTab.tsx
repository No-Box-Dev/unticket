/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { usePeople } from "@/hooks/useConfigRepo";
import { useActiveMembers, useAllPRs, useClosedIssues, useGhTeamMemberships, useOpenIssues } from "@/hooks/useGitHub";
import { useFeedActors, useFeedEvents } from "@/hooks/useNoxlink";
import { Spinner } from "@/components/Spinner";
import { ActorVoiceCard } from "@/components/ActorVoiceCard";
import { cn } from "@/lib/cn";
import {
  ArrowLeft,
  Circle,
  CircleCheck,
  ExternalLink,
  GitCommit,
  GitMerge,
  GitPullRequest,
  MessageSquare,
  Rocket,
  Tag,
  XCircle,
} from "lucide-react";
import type { FeedEvent } from "@/lib/noxlink-api";
import type { Person } from "@/lib/types";

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

export function EngineersTab({ repoNames, navFilter }: { repoNames: string[]; navFilter?: import("@/lib/types").NavFilter | null }) {
  const { data: people } = usePeople();
  const { data: orgMembers, isLoading: membersLoading } = useActiveMembers();
  const { data: allPRs, isLoading: allPRsLoading } = useAllPRs(repoNames);
  const { data: closedIssues } = useClosedIssues(repoNames);
  const { data: openIssues, isLoading: openIssuesLoading } = useOpenIssues(repoNames);
  const statsLoading = allPRsLoading || openIssuesLoading;
  const { data: ghTeams } = useGhTeamMemberships();

  const [selectedLogin, setSelectedLogin] = useState<string | null>(navFilter?.person ?? null);

  // Build engineer list
  const engineers = useMemo(() => {
    if (!orgMembers) return [];
    const peopleMap = new Map<string, Person>();
    for (const p of people ?? []) peopleMap.set(p.github, p);

    return orgMembers.map((member) => {
      const person = peopleMap.get(member.login);
      const openPRs = allPRs?.filter((pr: any) => pr.user?.login === member.login && pr.state === "open")?.length ?? 0;
      const reviewing = allPRs?.filter((pr: any) =>
        pr.state === "open"
        && !pr.draft
        && (pr.requested_reviewers ?? []).some((r: any) => r.login === member.login),
      )?.length ?? 0;
      const assignedIssues = openIssues?.filter((i: any) =>
        (i.assignees ?? []).some((a: any) => a.login === member.login),
      )?.length ?? 0;

      return {
        login: member.login,
        avatar_url: member.avatar_url,
        name: person?.name ?? member.login,
        role: person?.role ?? "",
        team: person?.team ?? "",
        description: person?.description ?? "",
        openPRs,
        reviewing,
        assignedIssues,
        ghTeams: ghTeams?.memberships?.[member.login] ?? [],
        kind: member.kind ?? (member.type === "Bot" ? "bot" : "human"),
      };
    });
  }, [orgMembers, people, allPRs, openIssues, ghTeams]);

  const selected = useMemo(() => {
    const login = selectedLogin ?? engineers[0]?.login;
    return engineers.find((e) => e.login === login) ?? engineers[0];
  }, [selectedLogin, engineers]);

  // Open issues currently assigned to the selected engineer.
  const assignedIssueList = useMemo<ListPanelItem[]>(() => {
    if (!selected) return [];
    return (openIssues ?? [])
      .filter((i: any) => (i.assignees ?? []).some((a: any) => a.login === selected.login))
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

  // Open PRs authored by the selected engineer.
  const openPrList = useMemo<ListPanelItem[]>(() => {
    if (!selected) return [];
    return (allPRs ?? [])
      .filter((pr: any) => pr.user?.login === selected.login && pr.state === "open")
      .map((pr: any) => ({
        kind: "pr" as const,
        repo: pr.head?.repo?.name ?? pr.repo,
        number: pr.number,
        title: pr.title,
        html_url: pr.html_url,
        timestamp: pr.updated_at ?? pr.created_at,
        draft: pr.draft,
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [selected, allPRs]);

  // Open PRs where the selected engineer is a requested reviewer.
  const reviewingList = useMemo<ListPanelItem[]>(() => {
    if (!selected) return [];
    return (allPRs ?? [])
      .filter((pr: any) =>
        pr.state === "open"
        && !pr.draft
        && (pr.requested_reviewers ?? []).some((r: any) => r.login === selected.login),
      )
      .map((pr: any) => ({
        kind: "pr" as const,
        repo: pr.head?.repo?.name ?? pr.repo,
        number: pr.number,
        title: pr.title,
        html_url: pr.html_url,
        timestamp: pr.updated_at ?? pr.created_at,
        draft: pr.draft,
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [selected, allPRs]);

  // Lifetime + recency stats (all-time / 4-week window).
  const lifetimePRs = useMemo(() => {
    if (!selected) return 0;
    return (allPRs ?? []).filter((pr: any) => pr.user?.login === selected.login).length;
  }, [selected, allPRs]);

  const prsLast4Weeks = useMemo(() => {
    if (!selected) return 0;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 28);
    const cutoff = cutoffDate.getTime();
    return (allPRs ?? []).filter((pr: any) =>
      pr.user?.login === selected.login
      && pr.created_at
      && new Date(pr.created_at).getTime() >= cutoff,
    ).length;
  }, [selected, allPRs]);

  const issuesClosed = useMemo(() => {
    if (!selected) return 0;
    return (closedIssues ?? []).filter((i: any) => i.closed_by === selected.login).length;
  }, [selected, closedIssues]);

  if (membersLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="w-6 h-6 text-accent" />
      </div>
    );
  }

  if (!engineers.length) {
    return <div className="text-center py-20 text-stone-400">No organization members found.</div>;
  }

  // Default landing: grid of cards. Click a card → set selectedLogin → detail view.
  if (!selectedLogin) {
    const sorted = [...engineers].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "bot" ? 1 : -1;
      const ax = a.openPRs + a.reviewing + a.assignedIssues;
      const bx = b.openPRs + b.reviewing + b.assignedIssues;
      if (bx !== ax) return bx - ax;
      return a.name.localeCompare(b.name);
    });

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {sorted.map((eng) => (
          <PersonCard key={eng.login} engineer={eng} onSelect={() => setSelectedLogin(eng.login)} statsLoading={statsLoading} />
        ))}
      </div>
    );
  }

  if (!selected) {
    return <div className="text-center py-20 text-stone-400">Engineer not found.</div>;
  }

  return (
    <div className="space-y-4">
      <button
        onClick={() => setSelectedLogin(null)}
        className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        All people
      </button>

      <div className="space-y-4">
        {/* Header */}
        <div className="bg-white border border-stone-200 rounded-xl p-5 flex items-center gap-4">
          {selected.avatar_url ? (
            <img src={selected.avatar_url} className="w-12 h-12 rounded-full shrink-0" alt="" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-stone-200 shrink-0 flex items-center justify-center text-lg font-bold text-stone-500">
              {selected.name?.[0]?.toUpperCase() ?? "?"}
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-stone-900 font-display truncate flex items-center gap-2">
              <span className="truncate">{selected.name}</span>
              {selected.kind === "bot" && (
                <span className="text-[10px] font-medium bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full shrink-0">Bot</span>
              )}
            </h2>
            {(selected.role || selected.team) && (
              <p className="text-sm text-stone-400 truncate">{[selected.role, selected.team].filter(Boolean).join(" · ")}</p>
            )}
            {selected.description && (
              <p className="text-sm text-stone-500 mt-0.5 line-clamp-2">{selected.description}</p>
            )}
          </div>
        </div>

        {/* Feed voice & tone — placed up top so it's easy to find and edit. */}
        <ActorVoiceCard githubLogin={selected.login} />

        {/* Lifetime / recency stat row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard label="Lifetime PRs" value={lifetimePRs} icon={<GitPullRequest size={14} className="text-stone-400" />} />
          <StatCard label="PRs · last 4 weeks" value={prsLast4Weeks} icon={<GitMerge size={14} className="text-stone-400" />} />
          <StatCard label="Issues closed" value={issuesClosed} icon={<CircleCheck size={14} className="text-stone-400" />} />
        </div>

        {/* Lists: Open PRs / Reviewing / Assigned Issues */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <ItemListPanel
            title="Open PRs"
            count={openPrList.length}
            items={openPrList}
            emptyMessage="No open PRs."
          />
          <ItemListPanel
            title="Reviewing"
            count={reviewingList.length}
            items={reviewingList}
            emptyMessage="Not assigned to review any PR."
          />
          <ItemListPanel
            title="Assigned Issues"
            count={assignedIssueList.length}
            items={assignedIssueList}
            emptyMessage="No open issues currently assigned."
          />
        </div>

        {/* Activity feed */}
        <ActivityFeed login={selected.login} />
      </div>
    </div>
  );
}

// ---------- PersonCard (NoxLink-style grid card) ----------

interface EngineerSummary {
  login: string;
  avatar_url: string;
  name: string;
  role: string;
  team: string;
  description: string;
  openPRs: number;
  reviewing: number;
  assignedIssues: number;
  ghTeams: string[];
  kind: "human" | "bot";
}

function PersonCard({ engineer, onSelect, statsLoading }: { engineer: EngineerSummary; onSelect: () => void; statsLoading?: boolean }) {
  return (
    <button
      onClick={onSelect}
      className="bg-white border border-stone-200 rounded-xl p-4 text-left hover:border-stone-300 hover:bg-stone-50/50 transition-colors cursor-pointer flex flex-col gap-3"
    >
      <div className="flex items-center gap-3 min-w-0">
        {engineer.avatar_url ? (
          <img src={engineer.avatar_url} className="w-10 h-10 rounded-full shrink-0" alt="" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-stone-200 shrink-0 flex items-center justify-center text-sm font-semibold text-stone-500">
            {engineer.name?.[0]?.toUpperCase() ?? "?"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-stone-900 truncate flex items-center gap-1.5">
            <span className="truncate">{engineer.name}</span>
            {engineer.kind === "bot" && (
              <span className="text-[9px] font-medium bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full shrink-0">Bot</span>
            )}
          </div>
          <div className="text-xs text-stone-400 truncate">
            {[engineer.role, engineer.team].filter(Boolean).join(" · ") || `@${engineer.login}`}
          </div>
        </div>
      </div>

      {engineer.ghTeams.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {engineer.ghTeams.map((team) => (
            <span
              key={team}
              className="text-[10px] font-medium bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded"
            >
              {team}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-4 text-xs text-stone-500">
        <CardStat label="Open PRs" value={engineer.openPRs} loading={statsLoading} />
        <CardStat label="Reviewing" value={engineer.reviewing} loading={statsLoading} />
        <CardStat label="Assigned Issues" value={engineer.assignedIssues} loading={statsLoading} />
      </div>
    </button>
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

// ---------- Stat Card (small stat with icon) ----------

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

// ---------- Item List Panel (count + scrollable list of issues or PRs) ----------

type ListPanelItem = {
  kind: "issue" | "pr";
  repo: string;
  number: number;
  title: string;
  html_url: string;
  timestamp: string;
  draft?: boolean;
};

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
                <Link
                  to={to}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-stone-50 group"
                >
                  {item.kind === "pr" ? (
                    <GitPullRequest size={12} className={cn("shrink-0", item.draft ? "text-stone-400" : "text-green-600")} />
                  ) : (
                    <Circle size={12} className="text-stone-400 shrink-0" />
                  )}
                  <span className="text-[11px] text-stone-400 shrink-0 font-mono">{item.repo}#{item.number}</span>
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

// ---------- Activity Feed (server-side: events table) ----------

type Category = "pr" | "review" | "issue" | "push" | "other";

type ActivityItem = {
  id: number;
  category: Category;
  type: string;
  label: string;
  repo: string | null;
  number: number | null;
  title: string;
  to: string | null;
  html_url: string | null;
  at: string;
};

const FILTER_BUTTONS: Array<{ id: "all" | Category; label: string }> = [
  { id: "all", label: "All" },
  { id: "pr", label: "PRs" },
  { id: "review", label: "Reviews" },
  { id: "issue", label: "Issues" },
  { id: "push", label: "Pushes" },
  { id: "other", label: "Other" },
];

function ActivityFeed({ login }: { login: string }) {
  const actors = useFeedActors();
  const actor = useMemo(
    () => (actors.data ?? []).find((a) => a.github_login === login) ?? null,
    [actors.data, login],
  );
  const events = useFeedEvents(
    { actorId: actor?.id, limit: 100 },
    { enabled: !!actor?.id },
  );

  const items = useMemo<ActivityItem[]>(() => {
    return (events.data ?? [])
      .map(buildItem)
      .filter((x): x is ActivityItem => x !== null);
  }, [events.data]);

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

  const isLoading = actors.isLoading || (!!actor?.id && events.isLoading);

  return (
    <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-status-production" />
          <h3 className="text-sm font-semibold text-stone-700">Live activity</h3>
          <span className="text-xs text-stone-400">last {items.length} events</span>
        </div>
        <div className="flex items-center gap-1 text-xs flex-wrap">
          {FILTER_BUTTONS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={cn(
                "px-2 py-1 rounded transition-colors cursor-pointer",
                filter === id
                  ? "bg-accent/10 text-accent"
                  : "text-stone-500 hover:bg-stone-100",
              )}
            >
              {label} ({counts[id] ?? 0})
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="p-6 text-center">
          <Spinner className="w-5 h-5 text-accent inline-block" />
        </div>
      ) : !actor ? (
        <div className="p-6 text-center text-sm text-stone-400">
          No tracked activity for @{login} yet — they'll appear here once they show up in a webhook event.
        </div>
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
        {item.repo ?? "—"}{item.number != null ? `#${item.number}` : ""}
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

// Map an event row to a display item. Returns null for types we don't surface.
function buildItem(e: FeedEvent): ActivityItem | null {
  const label = labelForType(e.type);
  if (!label) return null;

  const category = categoryForType(e.type);
  const payload = parsePayload(e.payload_json);
  const number = extractNumber(e, payload);
  const title = extractTitle(e, payload);
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

  return {
    id: e.id,
    category,
    type: e.type,
    label,
    repo,
    number,
    title,
    to,
    html_url,
    at: e.created_at,
  };
}

function categoryForType(type: string): Category {
  if (type.startsWith("github:pr:review:")) return "review";
  if (type.startsWith("github:pr:")) return "pr";
  if (type.startsWith("github:issue:")) return "issue";
  if (type === "github:push") return "push";
  return "other";
}

function labelForType(type: string): string | null {
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

function extractNumber(e: FeedEvent, payload: any): number | null {
  const fromPayload = payload?.pr?.number ?? payload?.issue?.number;
  if (typeof fromPayload === "number") return fromPayload;
  const m = e.summary?.match(/#(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function extractTitle(e: FeedEvent, payload: any): string {
  const fromPayload = payload?.pr?.title ?? payload?.issue?.title;
  if (fromPayload) return fromPayload;
  if (!e.summary) return "—";
  // Strip leading "PR #N: " / "Issue #N: " / "Review (state) on PR #N: " prefixes.
  const stripped = e.summary.replace(/^[^:]+:\s*/, "");
  return stripped || e.summary;
}
