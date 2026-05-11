/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from "react";
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
  // Drives the "Assigned Issues" panel that mirrors the card stat.
  const assignedIssueList = useMemo(() => {
    if (!selected) return [] as AssignedIssue[];
    return (openIssues ?? [])
      .filter((i: any) => (i.assignees ?? []).some((a: any) => a.login === selected.login))
      .map((i: any) => ({
        repo: i.repo,
        number: i.number,
        title: i.title,
        html_url: i.html_url,
        updated_at: i.updated_at,
      }))
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [selected, openIssues]);

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
        {/* Header with embedded metrics */}
        <div className="bg-white border border-stone-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="flex items-center gap-4 flex-1 min-w-0">
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
          <div className="flex flex-wrap items-stretch gap-x-4 gap-y-3 lg:border-l lg:border-stone-200 lg:pl-4">
            <InlineMetric label="Open PRs" value={selected.openPRs} />
            <InlineMetric label="Reviewing" value={selected.reviewing} />
            <InlineMetric label="Assigned Issues" value={selected.assignedIssues} />
          </div>
        </div>

        {/* Currently-assigned open issues — matches the "Assigned Issues" card stat. */}
        <AssignedIssuesPanel items={assignedIssueList} />

        {/* Voice (narrator tone, applied across every repo) */}
        <ActorVoiceCard githubLogin={selected.login} />

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

// ---------- Inline Metric (embedded in header) ----------

function InlineMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-start">
      <span className="text-xl font-bold font-display leading-none text-stone-800">{value}</span>
      <span className="text-[10px] font-medium text-stone-400 uppercase tracking-wider mt-1">{label}</span>
    </div>
  );
}

// ---------- Assigned Issues Panel ----------

type AssignedIssue = {
  repo: string;
  number: number;
  title: string;
  html_url: string;
  updated_at: string;
};

function AssignedIssuesPanel({ items }: { items: AssignedIssue[] }) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
        <div className="flex items-center gap-2">
          <Circle size={10} className="text-stone-300" />
          <h3 className="text-sm font-semibold text-stone-700">Assigned issues</h3>
          <span className="text-xs text-stone-400">{items.length} open</span>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="p-6 text-center text-sm text-stone-400">No open issues currently assigned.</div>
      ) : (
        <ol className="divide-y divide-stone-100 max-h-[420px] overflow-y-auto">
          {items.map((item) => (
            <li key={`${item.repo}#${item.number}`}>
              <a
                href={item.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50 group"
              >
                <Circle size={12} className="text-stone-400 shrink-0" />
                <span className="text-xs text-stone-400 shrink-0 font-mono">{item.repo}#{item.number}</span>
                <span className="text-sm text-stone-700 truncate flex-1">{item.title}</span>
                <span className="text-xs text-stone-400 shrink-0 w-16 text-right">{formatRelative(item.updated_at)}</span>
                <ExternalLink size={12} className="text-stone-300 opacity-0 group-hover:opacity-100 shrink-0" />
              </a>
            </li>
          ))}
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
          {visible.map((item) => (
            <li key={`${item.kind}:${item.repo}#${item.number}:${item.at}`}>
              <a
                href={item.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50 group"
              >
                <FeedIcon kind={item.kind} />
                <span className="text-xs text-stone-400 shrink-0 font-mono">{item.repo}#{item.number}</span>
                <span className="text-sm text-stone-700 truncate flex-1">{item.title}</span>
                <span className="text-xs text-stone-400 shrink-0">{labelFor(item.kind)}</span>
                <span className="text-xs text-stone-400 shrink-0 w-16 text-right">{formatRelative(item.at)}</span>
                <ExternalLink size={12} className="text-stone-300 opacity-0 group-hover:opacity-100 shrink-0" />
              </a>
            </li>
          ))}
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
