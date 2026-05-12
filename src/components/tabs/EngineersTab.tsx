/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { usePeople } from "@/hooks/useConfigRepo";
import { useActiveMembers, useAllPRs, useClosedIssues, useOpenIssues } from "@/hooks/useGitHub";
import { Spinner } from "@/components/Spinner";
import { ActorVoiceCard } from "@/components/ActorVoiceCard";
import { cn } from "@/lib/cn";
import { ArrowLeft, GitPullRequest, GitMerge, CircleCheck, ExternalLink, Circle } from "lucide-react";
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
  const { data: allPRs } = useAllPRs(repoNames);
  const { data: closedIssues } = useClosedIssues(repoNames);
  const { data: openIssues } = useOpenIssues(repoNames);

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
      };
    });
  }, [orgMembers, people, allPRs, openIssues]);

  const selected = useMemo(() => {
    const login = selectedLogin ?? engineers[0]?.login;
    return engineers.find((e) => e.login === login) ?? engineers[0];
  }, [selectedLogin, engineers]);

  // Build chronological activity feed for the selected engineer (last 30 days).
  const feed = useMemo<FeedItem[]>(() => {
    if (!selected) return [];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    const cutoff = cutoffDate.getTime();
    const items: FeedItem[] = [];

    for (const pr of allPRs ?? []) {
      const p = pr as any;
      if (p.user?.login !== selected.login) continue;
      if (p.merged_at && new Date(p.merged_at).getTime() >= cutoff) {
        items.push({ kind: "pr_merged", at: p.merged_at, repo: p.repo, number: p.number, title: p.title, html_url: p.html_url });
      } else if (!p.merged_at && p.created_at && new Date(p.created_at).getTime() >= cutoff) {
        items.push({ kind: "pr_opened", at: p.created_at, repo: p.repo, number: p.number, title: p.title, html_url: p.html_url });
      }
    }

    for (const issue of closedIssues ?? []) {
      const i = issue as any;
      if (i.closed_by !== selected.login) continue;
      if (i.closed_at && new Date(i.closed_at).getTime() >= cutoff) {
        items.push({ kind: "issue_closed", at: i.closed_at, repo: i.repo, number: i.number, title: i.title, html_url: i.html_url });
      }
    }

    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return items;
  }, [selected, allPRs, closedIssues]);

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
      const ax = a.openPRs + a.reviewing + a.assignedIssues;
      const bx = b.openPRs + b.reviewing + b.assignedIssues;
      if (bx !== ax) return bx - ax;
      return a.name.localeCompare(b.name);
    });

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {sorted.map((eng) => (
          <PersonCard key={eng.login} engineer={eng} onSelect={() => setSelectedLogin(eng.login)} />
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
            <h2 className="text-lg font-bold text-stone-900 font-display truncate">{selected.name}</h2>
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
        <ActivityFeed items={feed} />
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
}

function PersonCard({ engineer, onSelect }: { engineer: EngineerSummary; onSelect: () => void }) {
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
          <div className="text-sm font-semibold text-stone-900 truncate">{engineer.name}</div>
          <div className="text-xs text-stone-400 truncate">
            {[engineer.role, engineer.team].filter(Boolean).join(" · ") || `@${engineer.login}`}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-stone-500">
        <CardStat label="Open PRs" value={engineer.openPRs} />
        <CardStat label="Reviewing" value={engineer.reviewing} />
        <CardStat label="Assigned Issues" value={engineer.assignedIssues} />
      </div>
    </button>
  );
}

function CardStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-sm font-semibold text-stone-800 font-display">{value}</span>
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

// ---------- Activity Feed ----------

type FeedItem =
  | { kind: "pr_merged" | "pr_opened"; at: string; repo: string; number: number; title: string; html_url: string }
  | { kind: "issue_closed"; at: string; repo: string; number: number; title: string; html_url: string };

function ActivityFeed({ items }: { items: FeedItem[] }) {
  const [filter, setFilter] = useState<"all" | "prs" | "issues">("all");

  const visible = useMemo(() => {
    if (filter === "prs") return items.filter((i) => i.kind === "pr_merged" || i.kind === "pr_opened");
    if (filter === "issues") return items.filter((i) => i.kind === "issue_closed");
    return items;
  }, [items, filter]);

  const counts = useMemo(() => ({
    all: items.length,
    prs: items.filter((i) => i.kind === "pr_merged" || i.kind === "pr_opened").length,
    issues: items.filter((i) => i.kind === "issue_closed").length,
  }), [items]);

  return (
    <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-status-production" />
          <h3 className="text-sm font-semibold text-stone-700">Live activity</h3>
          <span className="text-xs text-stone-400">last 30 days</span>
        </div>
        <div className="flex items-center gap-1 text-xs">
          {(["all", "prs", "issues"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-2 py-1 rounded transition-colors capitalize cursor-pointer",
                filter === f
                  ? "bg-accent/10 text-accent"
                  : "text-stone-500  hover:bg-stone-100  ",
              )}
            >
              {f === "prs" ? "PRs" : f} ({counts[f]})
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="p-6 text-center text-sm text-stone-400">No activity in the last 30 days.</div>
      ) : (
        <ol className="divide-y divide-stone-100 max-h-[420px] overflow-y-auto">
          {visible.map((item) => {
            const to = item.kind === "issue_closed"
              ? `/issues/${item.repo}/${item.number}`
              : `/prs/${item.repo}/${item.number}`;
            return (
              <li key={`${item.kind}:${item.repo}#${item.number}:${item.at}`}>
                <Link
                  to={to}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50 group"
                >
                  <FeedIcon kind={item.kind} />
                  <span className="text-xs text-stone-400 shrink-0 font-mono">{item.repo}#{item.number}</span>
                  <span className="text-sm text-stone-700 truncate flex-1">{item.title}</span>
                  <span className="text-xs text-stone-400 shrink-0">{labelFor(item.kind)}</span>
                  <span className="text-xs text-stone-400 shrink-0 w-16 text-right">{formatRelative(item.at)}</span>
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
            );
          })}
        </ol>
      )}
    </div>
  );
}

function FeedIcon({ kind }: { kind: FeedItem["kind"] }) {
  if (kind === "pr_merged") return <GitMerge size={14} className="text-stone-400 shrink-0" />;
  if (kind === "pr_opened") return <GitPullRequest size={14} className="text-stone-400 shrink-0" />;
  return <CircleCheck size={14} className="text-stone-400 shrink-0" />;
}

function labelFor(kind: FeedItem["kind"]) {
  if (kind === "pr_merged") return "merged PR";
  if (kind === "pr_opened") return "opened PR";
  return "closed issue";
}
