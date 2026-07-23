/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useOpenPRs,
  useMergedPRs,
  useIsAdmin,
  useActiveMembers,
  useEngineerActivity,
  useEngineerStats,
} from "@/hooks/useGitHub";
import { useAuth } from "@/lib/auth";
import { useFeedProjects } from "@/hooks/useNoxlink";
import {
  ArrowLeft,
  CalendarDays,
  CircleCheck,
  ExternalLink,
  Folder,
  GitCommit,
  GitMerge,
  GitPullRequest,
  Users,
  XCircle,
} from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import { daysAgo, STALE_PR_DAYS } from "@/lib/dates";
import { SortIcon } from "@/components/ui/SortIcon";
import { ConfirmDialog, useConfirm } from "@/components/ui/ConfirmDialog";
import { AllMeToggle } from "@/components/ui/AllMeToggle";
import { closePR } from "@/lib/github";

type SortKey = "repo" | "title" | "author" | "age" | "reviewers";
type SortDir = "asc" | "desc";
type GroupBy = "people" | "repo";
type PRView = "draft" | "ready" | "merged";
type PersonPane = "prs" | "stats";

const VIEW_LABELS: Record<PRView, string> = {
  draft: "Draft",
  ready: "Ready",
  merged: "Merged",
};

interface CurrentTabProps {
  repoNames: string[];
  navFilter?: import("@/lib/types").NavFilter | null;
}

// URL params drive every navigation in this tab so links + browser-back
// stay coherent:
//   ?tab=current                          — Ready (open, non-draft) — the default
//   ?tab=current&view=draft               — Draft PRs
//   ?tab=current&view=merged              — Merged PRs
//   ?tab=current&by=repo                  — grid grouped by Repo
//   ?tab=current&author=<login>           — drilled into a person, PRs sub-tab
//   ?tab=current&author=<login>&pane=stats — drilled into a person, Stats sub-tab
//   ?tab=current&repo=<name>              — drilled into a repo's PRs
//   ?tab=current&scope=me                 — only the logged-in user's PRs
export function CurrentTab({ repoNames, navFilter }: CurrentTabProps) {
  const { user } = useAuth();
  const userLogin = user?.login.toLowerCase() ?? null;
  const [searchParams, setSearchParams] = useSearchParams();
  const meOnly = searchParams.get("scope") === "me";
  const rawView = searchParams.get("view");
  const view: PRView =
    rawView === "draft" ? "draft" : rawView === "merged" ? "merged" : "ready";
  const groupBy = (searchParams.get("by") as GroupBy) === "repo" ? "repo" : "people";
  const drillAuthor = searchParams.get("author") ?? navFilter?.person ?? null;
  const drillRepo = searchParams.get("repo") ?? null;
  const isDrilled = Boolean(drillAuthor || drillRepo);
  const pane: PersonPane = searchParams.get("pane") === "stats" ? "stats" : "prs";

  const { data: feedProjects } = useFeedProjects();
  const archivedRepos = useMemo(
    () => new Set((feedProjects ?? []).filter((p) => p.archived && p.repo).map((p) => p.repo!)),
    [feedProjects],
  );
  const activeRepoNames = useMemo(
    () => repoNames.filter((n) => !archivedRepos.has(n)),
    [repoNames, archivedRepos],
  );

  const { data: openPRs, isLoading: openLoading } = useOpenPRs(activeRepoNames);
  const { data: mergedPRs, isLoading: mergedLoading } = useMergedPRs(activeRepoNames);
  const { data: members } = useActiveMembers();

  // Draft and Ready share the same underlying fetch (open PRs), split
  // client-side by `pr.draft`. Merged uses the dedicated merged fetch.
  const prs = view === "merged" ? mergedPRs : openPRs;
  const isLoading = view === "merged" ? mergedLoading : openLoading;

  // Drop PRs from archived repos + apply the draft/ready split.
  const scopedPrs = useMemo(() => {
    let list = prs ?? [];
    if (archivedRepos.size > 0) {
      list = list.filter((pr: any) => !archivedRepos.has(pr.head.repo?.name));
    }
    if (view === "draft") list = list.filter((pr: any) => pr.draft);
    else if (view === "ready") list = list.filter((pr: any) => !pr.draft);
    if (meOnly && userLogin) {
      list = list.filter((pr: any) => pr.user?.login?.toLowerCase() === userLogin);
    }
    return list;
  }, [prs, archivedRepos, view, meOnly, userLogin]);

  const visibleMembers = useMemo(
    () => meOnly && userLogin
      ? (members ?? []).filter((m) => m.login.toLowerCase() === userLogin)
      : (members ?? []),
    [members, meOnly, userLogin],
  );
  const visibleRepos = useMemo(
    () => meOnly
      ? Array.from(new Set(scopedPrs.map((pr: any) => pr.head.repo?.name).filter(Boolean))) as string[]
      : activeRepoNames,
    [meOnly, scopedPrs, activeRepoNames],
  );

  const setUrl = useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams);
      params.set("tab", "current");
      for (const [k, v] of Object.entries(next)) {
        if (v == null) params.delete(k);
        else params.set(k, v);
      }
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // Only show the PR filter (Draft/Ready/Merged) when we're actually
  // rendering PR data — the grid, or the person drill-in on the PRs
  // sub-tab, or any repo drill-in. On the person Stats sub-tab it's noise.
  const showPrFilter = !isDrilled || !drillAuthor || pane === "prs";

  return (
    <div className="space-y-4" data-tab="current">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <AllMeToggle
          me={meOnly}
          onChange={(me) => setUrl({ scope: me ? "me" : null, person: null, author: null, repo: null, pane: null })}
        />
        {showPrFilter && (
          <div className="flex rounded-lg border border-stone-200 overflow-hidden">
            {(["draft", "ready", "merged"] as PRView[]).map((v, i) => (
              <button
                key={v}
                onClick={() =>
                  setUrl({
                    view: v === "ready" ? null : v,
                    author: null,
                    repo: null,
                    pane: null,
                  })
                }
                className={cn(
                  "px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors",
                  view === v
                    ? "bg-accent text-white"
                    : "bg-white text-stone-600 hover:bg-stone-50",
                  i > 0 && "border-l border-stone-200",
                )}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
        )}

        {!isDrilled && (
          <div className="flex rounded-lg border border-stone-200 overflow-hidden">
            {(["people", "repo"] as GroupBy[]).map((g, i) => (
              <button
                key={g}
                onClick={() => setUrl({ by: g === "people" ? null : g })}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors",
                  groupBy === g
                    ? "bg-accent text-white"
                    : "bg-white text-stone-600 hover:bg-stone-50",
                  i > 0 && "border-l border-stone-200",
                )}
              >
                {g === "people" ? <Users size={12} /> : <Folder size={12} />}
                {g === "people" ? "By People" : "By Repo"}
              </button>
            ))}
          </div>
        )}

        <span className="text-xs text-stone-400 ml-auto flex items-center gap-1.5">
          {isLoading
            ? <Spinner size="sm" />
            : `${scopedPrs.length} ${VIEW_LABELS[view].toLowerCase()} PR${scopedPrs.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {isDrilled ? (
        <DrilledView
          prs={scopedPrs}
          view={view}
          isLoading={isLoading}
          drillAuthor={drillAuthor}
          drillRepo={drillRepo}
          pane={pane}
          members={visibleMembers}
          onBack={() => setUrl({ author: null, repo: null, pane: null })}
          onPaneChange={(p) => setUrl({ pane: p === "prs" ? null : p })}
        />
      ) : isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner className="w-6 h-6 text-accent" />
        </div>
      ) : (
        <CardGrid
          prs={scopedPrs}
          groupBy={groupBy}
          view={view}
          members={visibleMembers}
          repos={visibleRepos}
          onOpen={(key) =>
            setUrl(groupBy === "people" ? { author: key, repo: null } : { repo: key, author: null })
          }
        />
      )}
    </div>
  );
}

// ---------- Card grid ----------

interface Bucket {
  key: string;              // login OR repo name
  label: string;
  avatarUrl: string | null; // people only
  count: number;
  draft: number;
  staleCount: number;
  avgAgeDays: number;
  newestUpdatedAt: string;
}

interface CardGridProps {
  prs: any[];
  groupBy: GroupBy;
  view: PRView;
  members: { login: string; avatar_url: string }[];
  repos: string[];
  onOpen: (key: string) => void;
}

function CardGrid({ prs, groupBy, view, members, repos, onOpen }: CardGridProps) {
  const avatarByLogin = useMemo(() => {
    const m = new Map<string, string>();
    members.forEach((mem) => m.set(mem.login, mem.avatar_url));
    return m;
  }, [members]);

  const buckets = useMemo<Bucket[]>(() => {
    const map = new Map<string, {
      key: string; label: string; avatarUrl: string | null;
      ages: number[]; draft: number; stale: number; newest: string; prs: any[];
    }>();

    const seed = (key: string, avatarUrl: string | null) => {
      map.set(key, {
        key, label: key, avatarUrl,
        ages: [], draft: 0, stale: 0, newest: "", prs: [],
      });
    };

    // Seed every active member (or repo) up front so a bucket with 0 PRs
    // still shows a card. "always show everyone on the PR page" — the
    // grid becomes a stable overview of the team/portfolio, not just a
    // list of people who happened to open something recently.
    if (groupBy === "people") {
      for (const m of members) seed(m.login, m.avatar_url ?? null);
    } else {
      for (const r of repos) seed(r, null);
    }

    for (const pr of prs) {
      const key = groupBy === "people"
        ? (pr.user?.login ?? "(unknown)")
        : (pr.head.repo?.name ?? "(unknown)");
      if (!map.has(key)) {
        // Falls back to auto-seeding for logins/repos we don't know about
        // yet (e.g. a bot author, a repo pre-discovery).
        seed(
          key,
          groupBy === "people"
            ? avatarByLogin.get(key) ?? pr.user?.avatar_url ?? null
            : null,
        );
      }
      const b = map.get(key)!;
      const age = daysAgo(pr.created_at);
      b.ages.push(age);
      if (pr.draft) b.draft += 1;
      if (age > STALE_PR_DAYS) b.stale += 1;
      const upd = pr.updated_at ?? pr.created_at;
      if (!b.newest || upd > b.newest) b.newest = upd;
      b.prs.push(pr);
    }
    return Array.from(map.values()).map((b) => ({
      key: b.key,
      label: b.label,
      avatarUrl: b.avatarUrl,
      count: b.prs.length,
      draft: b.draft,
      staleCount: b.stale,
      avgAgeDays: b.ages.length ? Math.round(b.ages.reduce((a, c) => a + c, 0) / b.ages.length) : 0,
      newestUpdatedAt: b.newest,
    }));
  }, [prs, groupBy, avatarByLogin, members, repos]);

  const sorted = useMemo(() => {
    // Buckets with PRs first (most-recent-activity tiebreak). Empty
    // buckets alphabetical so the grid layout stays stable across
    // renders instead of jumping around when someone opens a PR.
    return [...buckets].sort((a, b) => {
      if (a.count > 0 && b.count === 0) return -1;
      if (b.count > 0 && a.count === 0) return 1;
      if (a.count > 0) {
        if (b.count !== a.count) return b.count - a.count;
        return b.newestUpdatedAt.localeCompare(a.newestUpdatedAt);
      }
      return a.label.localeCompare(b.label);
    });
  }, [buckets]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {sorted.map((b) => (
        <BucketCard key={b.key} bucket={b} groupBy={groupBy} view={view} onOpen={() => onOpen(b.key)} />
      ))}
    </div>
  );
}

function BucketCard({ bucket, groupBy, view, onOpen }: {
  bucket: Bucket; groupBy: GroupBy; view: PRView; onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="bg-white border border-stone-200 rounded-xl p-4 text-left hover:border-stone-300 hover:bg-stone-50/50 transition-colors cursor-pointer flex flex-col gap-3"
    >
      <div className="flex items-center gap-3 min-w-0">
        {groupBy === "people" ? (
          bucket.avatarUrl ? (
            <img src={bucket.avatarUrl} alt="" className="w-10 h-10 rounded-full shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-stone-200 shrink-0 flex items-center justify-center text-sm font-semibold text-stone-500">
              {bucket.label[0]?.toUpperCase() ?? "?"}
            </div>
          )
        ) : (
          <div className="w-10 h-10 rounded-lg bg-stone-100 shrink-0 flex items-center justify-center text-stone-500">
            <Folder size={18} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-stone-900 truncate">{bucket.label}</div>
          <div className="text-xs text-stone-400 truncate">
            {VIEW_LABELS[view]} PRs
          </div>
        </div>
      </div>

      <div className="flex items-baseline gap-4 text-xs text-stone-500">
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-semibold text-stone-800 font-display tabular-nums">
            {bucket.count}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-stone-400">total</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-semibold text-stone-800 font-display tabular-nums">
            {bucket.avgAgeDays}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-stone-400">avg age (d)</span>
        </div>
        {view !== "merged" && bucket.staleCount > 0 && (
          <div className="flex items-baseline gap-1 text-amber-600">
            <span className="text-lg font-semibold font-display tabular-nums">
              {bucket.staleCount}
            </span>
            <span className="text-[10px] uppercase tracking-wider">stale</span>
          </div>
        )}
      </div>
    </button>
  );
}

// ---------- Drilled-in list ----------

interface DrilledViewProps {
  prs: any[];
  view: PRView;
  isLoading: boolean;
  drillAuthor: string | null;
  drillRepo: string | null;
  pane: PersonPane;
  members: { login: string; avatar_url: string }[];
  onBack: () => void;
  onPaneChange: (pane: PersonPane) => void;
}

function DrilledView({ prs, view, isLoading, drillAuthor, drillRepo, pane, members, onBack, onPaneChange }: DrilledViewProps) {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  const { confirm, dialogProps } = useConfirm();

  const [sortKey, setSortKey] = useState<SortKey>("age");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const closeMut = useMutation({
    mutationFn: ({ repo, number }: { repo: string; number: number }) => closePR(repo, number),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prs", selectedOrg] });
    },
  });

  const filtered = useMemo(() => {
    return prs.filter((pr: any) => {
      if (drillAuthor && pr.user?.login !== drillAuthor) return false;
      if (drillRepo && pr.head.repo?.name !== drillRepo) return false;
      return true;
    });
  }, [prs, drillAuthor, drillRepo]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a: any, b: any) => {
      switch (sortKey) {
        case "repo":
          return dir * (a.head.repo?.name ?? "").localeCompare(b.head.repo?.name ?? "");
        case "title":
          return dir * a.title.localeCompare(b.title);
        case "author":
          return dir * (a.user?.login ?? "").localeCompare(b.user?.login ?? "");
        case "age":
          return dir * (daysAgo(a.created_at) - daysAgo(b.created_at));
        case "reviewers":
          return dir * ((a.requested_reviewers?.length ?? 0) - (b.requested_reviewers?.length ?? 0));
        default:
          return 0;
      }
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const scopeLabel = drillAuthor ? `@${drillAuthor}` : drillRepo ?? "";
  const isPersonDrill = Boolean(drillAuthor);
  const personMember = drillAuthor
    ? members.find((m) => m.login === drillAuthor)
    : undefined;

  async function handleClose(repo: string, number: number, title: string) {
    const ok = await confirm({
      title: `Close PR #${number}?`,
      message: `"${title}" will be closed on GitHub without merging.`,
      confirmLabel: "Close PR",
      variant: "danger",
    });
    if (ok) closeMut.mutate({ repo, number });
  }

  return (
    <div className="space-y-3">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to all
      </button>

      {isPersonDrill && (
        <div className="flex items-center gap-3">
          {personMember?.avatar_url ? (
            <img src={personMember.avatar_url} alt="" className="w-10 h-10 rounded-full shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-stone-200 shrink-0 flex items-center justify-center text-sm font-semibold text-stone-500">
              {drillAuthor?.[0]?.toUpperCase() ?? "?"}
            </div>
          )}
          <h2 className="text-lg font-semibold text-stone-800">{scopeLabel}</h2>
        </div>
      )}

      {isPersonDrill && (
        <div className="flex rounded-lg border border-stone-200 overflow-hidden w-fit">
          {(["prs", "stats"] as PersonPane[]).map((p, i) => (
            <button
              key={p}
              onClick={() => onPaneChange(p)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors",
                pane === p
                  ? "bg-accent text-white"
                  : "bg-white text-stone-600 hover:bg-stone-50",
                i > 0 && "border-l border-stone-200",
              )}
            >
              {p === "prs" ? "PRs" : "Stats"}
            </button>
          ))}
        </div>
      )}

      {!isPersonDrill && (
        <h2 className="text-lg font-semibold text-stone-800">
          {scopeLabel}
          <span className="ml-2 text-xs font-normal text-stone-400">
            {sorted.length} {view} PR{sorted.length === 1 ? "" : "s"}
          </span>
        </h2>
      )}

      {isPersonDrill && pane === "stats" ? (
        <PersonStats login={drillAuthor!} />
      ) : (
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 text-left">
              <th onClick={() => toggleSort("repo")} className="px-4 py-2.5 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700">
                PR <SortIcon column="repo" activeSortKey={sortKey} activeSortDirection={sortDir} />
              </th>
              <th onClick={() => toggleSort("title")} className="px-4 py-2.5 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700">
                Title <SortIcon column="title" activeSortKey={sortKey} activeSortDirection={sortDir} />
              </th>
              <th onClick={() => toggleSort("author")} className="px-4 py-2.5 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700">
                Author <SortIcon column="author" activeSortKey={sortKey} activeSortDirection={sortDir} />
              </th>
              <th onClick={() => toggleSort("reviewers")} className="px-4 py-2.5 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700">
                Reviewers <SortIcon column="reviewers" activeSortKey={sortKey} activeSortDirection={sortDir} />
              </th>
              <th onClick={() => toggleSort("age")} className="px-4 py-2.5 text-xs font-medium text-stone-500 text-right cursor-pointer hover:text-stone-700">
                Age <SortIcon column="age" activeSortKey={sortKey} activeSortDirection={sortDir} />
              </th>
              <th className="px-4 py-2.5 w-8"></th>
              {isAdmin && view !== "merged" && (
                <th className="px-4 py-2.5 w-8"></th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {isLoading ? (
              <tr>
                <td colSpan={isAdmin && view !== "merged" ? 7 : 6} className="px-4 py-8 text-center">
                  <Spinner className="mx-auto" />
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={isAdmin && view !== "merged" ? 7 : 6} className="px-4 py-8 text-center text-stone-400">
                  No pull requests found.
                </td>
              </tr>
            ) : (
              sorted.map((pr: any) => {
                const age = daysAgo(pr.created_at);
                const isStale = age > STALE_PR_DAYS;
                const repoName = pr.head.repo?.name ?? "";
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
                      "hover:bg-stone-50 cursor-pointer focus:bg-stone-50 focus:outline-none",
                      isStale && "bg-amber-50",
                    )}
                  >
                    <td className="px-4 py-2.5 text-stone-500 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {view === "merged" ? (
                          <GitMerge className="w-4 h-4 text-accent" />
                        ) : (
                          <GitPullRequest className={cn("w-4 h-4", pr.draft ? "text-stone-400" : "text-green-600")} />
                        )}
                        {repoName && (
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
                      <div className="text-xs text-stone-400 truncate">
                        {pr.head.ref} → {pr.base.ref}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-stone-500">
                      {pr.user?.login ? (
                        <Link
                          to={`/prs/author/${pr.user.login}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-accent hover:underline"
                        >
                          {pr.user.login}
                        </Link>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-stone-500 text-xs">
                      {(pr.requested_reviewers ?? []).length > 0
                        ? (pr.requested_reviewers ?? []).map((r: any) => r.login).join(", ")
                        : <span className="text-stone-300">none</span>}
                    </td>
                    <td className={cn("px-4 py-2.5 text-right tabular-nums", isStale ? "text-amber-600 font-medium" : "text-stone-400")}>
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
                    {isAdmin && view !== "merged" && (
                      <td className="px-4 py-2.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleClose(repoName, pr.number, pr.title);
                          }}
                          disabled={closeMut.isPending}
                          className="text-stone-300 hover:text-red-500 cursor-pointer disabled:opacity-40"
                          title="Close PR (without merging)"
                          aria-label={`Close PR #${pr.number}`}
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      )}

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}

// ---------- Person Stats pane (5 headline stat cards only) ----------

function PersonStats({ login }: { login: string }) {
  const { data: stats, isLoading } = useEngineerStats();
  const audit = stats?.prAudits?.[login];
  const approvalsSince = stats?.coverage?.approvalsGivenSince
    ? new Date(stats.coverage.approvalsGivenSince).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;
  const mergeCoverage = stats?.coverage?.mergedPRs
    ? Math.round((stats.coverage.mergedByKnown / stats.coverage.mergedPRs) * 100)
    : 0;
  const cards = [
    {
      label: "Authored PRs opened",
      value: stats?.lifetimePRs?.[login] ?? 0,
      detail: audit && audit.githubPRs === audit.cachedAllPRs
        ? `GitHub verified · ${audit.cachedTrackedPRs} while tracked of ${audit.githubPRs}`
        : undefined,
      icon: <GitPullRequest size={14} className="text-stone-400" />,
    },
    { label: "Opened · last 4 weeks", value: stats?.prsLast4Weeks?.[login] ?? 0, icon: <GitMerge size={14} className="text-stone-400" /> },
    { label: "Authored commits", value: stats?.lifetimeCommits?.[login] ?? 0, icon: <GitCommit size={14} className="text-stone-400" /> },
    { label: "Commits · last 4 weeks", value: stats?.commitsLast4Weeks?.[login] ?? 0, icon: <GitCommit size={14} className="text-stone-400" /> },
    {
      label: "Approvals captured",
      value: stats?.approvalsGiven?.[login] ?? 0,
      detail: approvalsSince ? `Since ${approvalsSince}` : "No review history captured",
      icon: <CircleCheck size={14} className="text-stone-400" />,
    },
    {
      label: "Merges captured",
      value: stats?.mergesOfOthers?.[login] ?? 0,
      detail: `${mergeCoverage}% of merged PRs have merger data`,
      icon: <GitMerge size={14} className="text-stone-400" />,
    },
    { label: "Issues closed", value: stats?.issuesClosed?.[login] ?? 0, icon: <CircleCheck size={14} className="text-stone-400" /> },
  ];

  if (isLoading && !stats) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="w-6 h-6 text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-white border border-stone-200 rounded-xl p-4">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-stone-400 uppercase tracking-wider">
              {c.icon}
              <span>{c.label}</span>
            </div>
            <div className="text-2xl font-bold font-display text-stone-800 mt-2 leading-none">{c.value}</div>
            {c.detail ? <div className="mt-2 text-[10px] leading-snug text-stone-400">{c.detail}</div> : null}
          </div>
        ))}
      </div>
      <ActivityDashboard login={login} />
    </div>
  );
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function enumerateMonths(start: string, end: string): string[] {
  const [startYear, startMonth] = start.split("-").map(Number);
  const [endYear, endMonth] = end.split("-").map(Number);
  if (!startYear || !startMonth || !endYear || !endMonth) return [end];
  const months: string[] = [];
  let year = startYear;
  let month = startMonth;
  while ((year < endYear || (year === endYear && month <= endMonth)) && months.length < 240) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      year += 1;
      month = 1;
    }
  }
  return months.length > 0 ? months : [end];
}

function daysInMonth(monthKey: string): string[] {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return [];
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => `${monthKey}-${String(index + 1).padStart(2, "0")}`);
}

function formatMonth(monthKey: string, long = false): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, 1)).toLocaleDateString("en-US", {
    month: long ? "long" : "short",
    year: long ? "numeric" : "2-digit",
    timeZone: "UTC",
  });
}

function ActivityDashboard({ login }: { login: string }) {
  const nowMonth = currentMonthKey();
  const [selectedMonth, setSelectedMonth] = useState<string>();
  const { data, isLoading } = useEngineerActivity(login, selectedMonth);
  const shownMonth = data?.month ?? selectedMonth ?? nowMonth;
  const days = useMemo(() => daysInMonth(shownMonth), [shownMonth]);
  const firstMonth = data?.firstMonth ?? shownMonth;
  const monthOptions = useMemo(
    () => enumerateMonths(firstMonth, nowMonth).reverse(),
    [firstMonth, nowMonth],
  );
  const trendMonths = useMemo(
    () => enumerateMonths(firstMonth, nowMonth).slice(-12),
    [firstMonth, nowMonth],
  );

  const opened = data?.prsOpened ?? {};
  const merged = data?.prsMerged ?? {};
  const reviewed = data?.prsReviewed ?? {};
  const commits = data?.commits ?? {};
  let openedTotal = 0;
  let mergedTotal = 0;
  let reviewedTotal = 0;
  let commitTotal = 0;
  let activeDays = 0;
  let peakDay = "";
  let peakCount = 0;
  for (const day of days) {
    const openedCount = opened[day] ?? 0;
    const mergedCount = merged[day] ?? 0;
    const reviewedCount = reviewed[day] ?? 0;
    const commitCount = commits[day] ?? 0;
    const total = openedCount + mergedCount + reviewedCount;
    openedTotal += openedCount;
    mergedTotal += mergedCount;
    reviewedTotal += reviewedCount;
    commitTotal += commitCount;
    if (total > 0) activeDays += 1;
    if (total > peakCount) {
      peakCount = total;
      peakDay = day;
    }
  }

  return (
    <section className="bg-white border border-stone-200 rounded-xl overflow-hidden" aria-labelledby="activity-heading">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-stone-100">
        <div>
          <div className="flex items-center gap-2">
            <h3 id="activity-heading" className="text-sm font-semibold text-stone-800">Contribution activity</h3>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Tracked at the time</span>
          </div>
          <p className="text-xs text-stone-400 mt-0.5">Authored commits, PRs by open/merge date, and distinct PRs reviewed</p>
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs text-stone-500">
          <CalendarDays size={14} />
          <span className="sr-only">Activity month</span>
          <select
            aria-label="Activity month"
            value={shownMonth}
            onChange={(event) => setSelectedMonth(event.target.value)}
            className="rounded-md border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700"
          >
            {monthOptions.map((month) => <option key={month} value={month}>{formatMonth(month, true)}</option>)}
          </select>
        </label>
      </div>

      {isLoading && !data ? (
        <div className="flex justify-center py-16"><Spinner className="w-5 h-5 text-accent" /></div>
      ) : (
        <div className="space-y-5 p-4">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <ActivitySummary label="Authored · opened" value={openedTotal} color="bg-teal-600" />
            <ActivitySummary label="Authored · merged" value={mergedTotal} color="bg-amber-500" />
            <ActivitySummary label="PRs reviewed" value={reviewedTotal} color="bg-violet-500" />
            <ActivitySummary label="Authored commits" value={commitTotal} color="bg-blue-600" />
            <ActivitySummary label="Active days" value={activeDays} detail={`of ${days.length}`} />
            <ActivitySummary
              label="Peak day"
              value={peakCount}
              detail={peakDay ? new Date(`${peakDay}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "No activity"}
            />
          </div>

          <div>
            <ChartHeading title={`Daily activity · ${formatMonth(shownMonth, true)}`} />
            <DailyActivityChart days={days} opened={opened} merged={merged} reviewed={reviewed} commits={commits} />
          </div>

          <div>
            <ChartHeading title="Last 12 months" />
            <MonthlyActivityChart
              months={trendMonths}
              opened={data?.monthlyOpened ?? {}}
              merged={data?.monthlyMerged ?? {}}
              reviewed={data?.monthlyReviewed ?? {}}
              commits={data?.monthlyCommits ?? {}}
            />
          </div>

          <p className="text-[11px] text-stone-400">
            Commits are authored commits reachable from each tracked repository&apos;s default branch, dated by their Git author timestamp. Archived and transferred repositories retain activity from their tracked periods. Review history starts when the GitHub App began receiving events; repeated reviews of one PR on one day count once.
          </p>
        </div>
      )}
    </section>
  );
}

function ActivitySummary({ label, value, detail, color }: { label: string; value: number; detail?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-stone-100 bg-stone-50/70 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-stone-400">
        {color ? <span className={cn("h-2 w-2 rounded-sm", color)} /> : null}
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-xl font-bold font-display tabular-nums text-stone-800">{value}</span>
        {detail ? <span className="text-xs text-stone-400">{detail}</span> : null}
      </div>
    </div>
  );
}

function ChartHeading({ title }: { title: string }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h4 className="text-xs font-medium text-stone-600">{title}</h4>
      <div className="flex gap-3 text-[10px] text-stone-400">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-teal-600" />Opened</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-500" />Merged</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-violet-500" />Reviewed</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-blue-600" />Commits</span>
      </div>
    </div>
  );
}

function chartScale(maximum: number): { top: number; ticks: number[] } {
  const safeMaximum = Math.max(1, maximum);
  const roughStep = safeMaximum / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep || 1));
  const normalized = roughStep / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = Math.max(1, niceNormalized * magnitude);
  const top = Math.ceil(safeMaximum / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top; value += step) ticks.push(value);
  return { top, ticks };
}

function formatDayPoint(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

interface ChartHover {
  x: number;
  label: string;
  value: number;
  color: string;
  unit?: "PRs" | "commits";
}

function ChartTooltip({ hover, left, right }: { hover: ChartHover; left: number; right: number }) {
  const tooltipWidth = 150;
  const x = Math.min(Math.max(hover.x - tooltipWidth / 2, left), right - tooltipWidth);
  return (
    <g transform={`translate(${x} 2)`} pointerEvents="none" aria-hidden="true">
      <rect width={tooltipWidth} height="28" rx="5" fill="#292524" opacity="0.96" />
      <circle cx="9" cy="9" r="3" fill={hover.color} />
      <text x="16" y="12" fontSize="8" fill="#fafaf9">{hover.label}</text>
      <text x="9" y="23" fontSize="9" fontWeight="600" fill="#ffffff">
        {hover.unit === "commits"
          ? `${hover.value} commit${hover.value === 1 ? "" : "s"}`
          : `${hover.value} PR${hover.value === 1 ? "" : "s"}`}
      </text>
    </g>
  );
}

function DailyActivityChart({ days, opened, merged, reviewed, commits }: {
  days: string[];
  opened: Record<string, number>;
  merged: Record<string, number>;
  reviewed: Record<string, number>;
  commits: Record<string, number>;
}) {
  const [hover, setHover] = useState<ChartHover | null>(null);
  const maximum = Math.max(
    1,
    ...days.flatMap((day) => [opened[day] ?? 0, merged[day] ?? 0, reviewed[day] ?? 0, commits[day] ?? 0]),
  );
  const { top, ticks } = chartScale(maximum);
  const left = 42;
  const right = 12;
  const chartTop = 18;
  const plotHeight = 108;
  const baseY = chartTop + plotHeight;
  const bottom = 40;
  const plotWidth = Math.max(720, days.length * 30);
  const width = left + plotWidth + right;
  const height = baseY + bottom;
  const groupWidth = plotWidth / Math.max(days.length, 1);
  const barWidth = Math.max(3, Math.min(6, groupWidth * 0.18));
  return (
    <div className="overflow-x-auto rounded-lg border border-stone-100 bg-stone-50/40">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-44 min-w-[760px] w-full" role="img" aria-label="Daily contribution activity bar chart with day and activity count axes">
        <text x="12" y={chartTop + plotHeight / 2} transform={`rotate(-90 12 ${chartTop + plotHeight / 2})`} textAnchor="middle" fontSize="9" fill="#78716c">Activity count</text>
        {ticks.map((tick) => {
          const y = baseY - (tick / top) * plotHeight;
          return (
            <g key={tick}>
              <line x1={left} y1={y} x2={left + plotWidth} y2={y} stroke="#e7e5e4" strokeDasharray={tick === 0 ? undefined : "3 3"} />
              <text x={left - 7} y={y + 3} textAnchor="end" fontSize="8" fill="#78716c">{tick}</text>
            </g>
          );
        })}
        {days.map((day, index) => {
          const openedValue = opened[day] ?? 0;
          const mergedValue = merged[day] ?? 0;
          const reviewedValue = reviewed[day] ?? 0;
          const commitValue = commits[day] ?? 0;
          const x = left + index * groupWidth + groupWidth / 2;
          const openedHeight = (openedValue / top) * plotHeight;
          const mergedHeight = (mergedValue / top) * plotHeight;
          const reviewedHeight = (reviewedValue / top) * plotHeight;
          const commitHeight = (commitValue / top) * plotHeight;
          return (
            <g key={day} aria-label={`${formatDayPoint(day)}: ${openedValue} opened, ${mergedValue} merged, ${reviewedValue} reviewed, ${commitValue} commits`}>
              <title>{`${day}: ${openedValue} opened, ${mergedValue} merged, ${reviewedValue} reviewed, ${commitValue} commits`}</title>
              <rect
                x={x - barWidth * 2 - 3}
                y={baseY - Math.max(openedHeight, 1)}
                width={barWidth}
                height={Math.max(openedHeight, 1)}
                rx="1.5"
                fill="#0d9488"
                className="cursor-help outline-none focus:stroke-stone-800 focus:stroke-1"
                tabIndex={0}
                aria-label={`${formatDayPoint(day)}, PRs opened: ${openedValue}`}
                onMouseEnter={() => setHover({ x, label: `${formatDayPoint(day)} · Opened`, value: openedValue, color: "#0d9488" })}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover({ x, label: `${formatDayPoint(day)} · Opened`, value: openedValue, color: "#0d9488" })}
                onBlur={() => setHover(null)}
              />
              <rect
                x={x - barWidth - 1}
                y={baseY - Math.max(mergedHeight, 1)}
                width={barWidth}
                height={Math.max(mergedHeight, 1)}
                rx="1.5"
                fill="#f59e0b"
                className="cursor-help outline-none focus:stroke-stone-800 focus:stroke-1"
                tabIndex={0}
                aria-label={`${formatDayPoint(day)}, authored PRs merged: ${mergedValue}`}
                onMouseEnter={() => setHover({ x, label: `${formatDayPoint(day)} · Merged`, value: mergedValue, color: "#f59e0b" })}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover({ x, label: `${formatDayPoint(day)} · Merged`, value: mergedValue, color: "#f59e0b" })}
                onBlur={() => setHover(null)}
              />
              <rect
                x={x + 1}
                y={baseY - Math.max(reviewedHeight, 1)}
                width={barWidth}
                height={Math.max(reviewedHeight, 1)}
                rx="1.5"
                fill="#8b5cf6"
                className="cursor-help outline-none focus:stroke-stone-800 focus:stroke-1"
                tabIndex={0}
                aria-label={`${formatDayPoint(day)}, PRs reviewed: ${reviewedValue}`}
                onMouseEnter={() => setHover({ x, label: `${formatDayPoint(day)} · Reviewed`, value: reviewedValue, color: "#8b5cf6" })}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover({ x, label: `${formatDayPoint(day)} · Reviewed`, value: reviewedValue, color: "#8b5cf6" })}
                onBlur={() => setHover(null)}
              />
              <rect
                x={x + barWidth + 3}
                y={baseY - Math.max(commitHeight, 1)}
                width={barWidth}
                height={Math.max(commitHeight, 1)}
                rx="1.5"
                fill="#2563eb"
                className="cursor-help outline-none focus:stroke-stone-800 focus:stroke-1"
                tabIndex={0}
                aria-label={`${formatDayPoint(day)}, authored commits: ${commitValue}`}
                onMouseEnter={() => setHover({ x, label: `${formatDayPoint(day)} · Commits`, value: commitValue, color: "#2563eb", unit: "commits" })}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover({ x, label: `${formatDayPoint(day)} · Commits`, value: commitValue, color: "#2563eb", unit: "commits" })}
                onBlur={() => setHover(null)}
              />
              {openedValue > 0 ? <text x={x - barWidth * 1.5 - 3} y={Math.max(chartTop + 7, baseY - openedHeight - 3)} textAnchor="middle" fontSize="7" fill="#0f766e">{openedValue}</text> : null}
              {mergedValue > 0 ? <text x={x - barWidth / 2 - 1} y={Math.max(chartTop + 7, baseY - mergedHeight - 3)} textAnchor="middle" fontSize="7" fill="#b45309">{mergedValue}</text> : null}
              {reviewedValue > 0 ? <text x={x + barWidth / 2 + 1} y={Math.max(chartTop + 7, baseY - reviewedHeight - 3)} textAnchor="middle" fontSize="7" fill="#7c3aed">{reviewedValue}</text> : null}
              {commitValue > 0 ? <text x={x + barWidth * 1.5 + 3} y={Math.max(chartTop + 7, baseY - commitHeight - 3)} textAnchor="middle" fontSize="7" fill="#1d4ed8">{commitValue}</text> : null}
              <text x={x} y={baseY + 14} textAnchor="middle" fontSize="7.5" fill="#78716c">{formatDayPoint(day)}</text>
            </g>
          );
        })}
        <text x={left + plotWidth / 2} y={height - 5} textAnchor="middle" fontSize="9" fill="#78716c">Day</text>
        {hover ? <ChartTooltip hover={hover} left={left} right={left + plotWidth} /> : null}
      </svg>
    </div>
  );
}

function MonthlyActivityChart({ months, opened, merged, reviewed, commits }: {
  months: string[];
  opened: Record<string, number>;
  merged: Record<string, number>;
  reviewed: Record<string, number>;
  commits: Record<string, number>;
}) {
  const [hover, setHover] = useState<ChartHover | null>(null);
  const maximum = Math.max(
    1,
    ...months.flatMap((month) => [opened[month] ?? 0, merged[month] ?? 0, reviewed[month] ?? 0, commits[month] ?? 0]),
  );
  const { top, ticks } = chartScale(maximum);
  const left = 42;
  const right = 12;
  const chartTop = 18;
  const plotHeight = 108;
  const baseY = chartTop + plotHeight;
  const bottom = 40;
  const plotWidth = Math.max(560, months.length * 92);
  const width = left + plotWidth + right;
  const height = baseY + bottom;
  const groupWidth = plotWidth / Math.max(months.length, 1);
  const barWidth = Math.min(12, groupWidth * 0.16);
  return (
    <div className="overflow-x-auto rounded-lg border border-stone-100 bg-stone-50/40">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-44 min-w-[620px] w-full" role="img" aria-label="Monthly contribution activity bar chart with month and activity count axes">
        <text x="12" y={chartTop + plotHeight / 2} transform={`rotate(-90 12 ${chartTop + plotHeight / 2})`} textAnchor="middle" fontSize="9" fill="#78716c">Activity count</text>
        {ticks.map((tick) => {
          const y = baseY - (tick / top) * plotHeight;
          return (
            <g key={tick}>
              <line x1={left} y1={y} x2={left + plotWidth} y2={y} stroke="#e7e5e4" strokeDasharray={tick === 0 ? undefined : "3 3"} />
              <text x={left - 7} y={y + 3} textAnchor="end" fontSize="8" fill="#78716c">{tick}</text>
            </g>
          );
        })}
        {months.map((month, index) => {
          const openedValue = opened[month] ?? 0;
          const mergedValue = merged[month] ?? 0;
          const reviewedValue = reviewed[month] ?? 0;
          const commitValue = commits[month] ?? 0;
          const x = left + index * groupWidth + groupWidth / 2;
          const openedHeight = (openedValue / top) * plotHeight;
          const mergedHeight = (mergedValue / top) * plotHeight;
          const reviewedHeight = (reviewedValue / top) * plotHeight;
          const commitHeight = (commitValue / top) * plotHeight;
          return (
            <g key={month} aria-label={`${formatMonth(month, true)}: ${openedValue} opened, ${mergedValue} merged, ${reviewedValue} reviewed, ${commitValue} commits`}>
              <title>{`${formatMonth(month, true)}: ${openedValue} opened, ${mergedValue} merged, ${reviewedValue} reviewed, ${commitValue} commits`}</title>
              <rect
                x={x - barWidth * 2 - 4}
                y={baseY - Math.max(openedHeight, 1)}
                width={barWidth}
                height={Math.max(openedHeight, 1)}
                rx="2"
                fill="#0d9488"
                className="cursor-help outline-none focus:stroke-stone-800 focus:stroke-1"
                tabIndex={0}
                aria-label={`${formatMonth(month, true)}, PRs opened: ${openedValue}`}
                onMouseEnter={() => setHover({ x, label: `${formatMonth(month, true)} · Opened`, value: openedValue, color: "#0d9488" })}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover({ x, label: `${formatMonth(month, true)} · Opened`, value: openedValue, color: "#0d9488" })}
                onBlur={() => setHover(null)}
              />
              <rect
                x={x - barWidth - 1}
                y={baseY - Math.max(mergedHeight, 1)}
                width={barWidth}
                height={Math.max(mergedHeight, 1)}
                rx="2"
                fill="#f59e0b"
                className="cursor-help outline-none focus:stroke-stone-800 focus:stroke-1"
                tabIndex={0}
                aria-label={`${formatMonth(month, true)}, authored PRs merged: ${mergedValue}`}
                onMouseEnter={() => setHover({ x, label: `${formatMonth(month, true)} · Merged`, value: mergedValue, color: "#f59e0b" })}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover({ x, label: `${formatMonth(month, true)} · Merged`, value: mergedValue, color: "#f59e0b" })}
                onBlur={() => setHover(null)}
              />
              <rect
                x={x + 1}
                y={baseY - Math.max(reviewedHeight, 1)}
                width={barWidth}
                height={Math.max(reviewedHeight, 1)}
                rx="2"
                fill="#8b5cf6"
                className="cursor-help outline-none focus:stroke-stone-800 focus:stroke-1"
                tabIndex={0}
                aria-label={`${formatMonth(month, true)}, PRs reviewed: ${reviewedValue}`}
                onMouseEnter={() => setHover({ x, label: `${formatMonth(month, true)} · Reviewed`, value: reviewedValue, color: "#8b5cf6" })}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover({ x, label: `${formatMonth(month, true)} · Reviewed`, value: reviewedValue, color: "#8b5cf6" })}
                onBlur={() => setHover(null)}
              />
              <rect
                x={x + barWidth + 4}
                y={baseY - Math.max(commitHeight, 1)}
                width={barWidth}
                height={Math.max(commitHeight, 1)}
                rx="2"
                fill="#2563eb"
                className="cursor-help outline-none focus:stroke-stone-800 focus:stroke-1"
                tabIndex={0}
                aria-label={`${formatMonth(month, true)}, authored commits: ${commitValue}`}
                onMouseEnter={() => setHover({ x, label: `${formatMonth(month, true)} · Commits`, value: commitValue, color: "#2563eb", unit: "commits" })}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover({ x, label: `${formatMonth(month, true)} · Commits`, value: commitValue, color: "#2563eb", unit: "commits" })}
                onBlur={() => setHover(null)}
              />
              {openedValue > 0 ? <text x={x - barWidth * 1.5 - 4} y={Math.max(chartTop + 7, baseY - openedHeight - 4)} textAnchor="middle" fontSize="8" fill="#0f766e">{openedValue}</text> : null}
              {mergedValue > 0 ? <text x={x - barWidth / 2 - 1} y={Math.max(chartTop + 7, baseY - mergedHeight - 4)} textAnchor="middle" fontSize="8" fill="#b45309">{mergedValue}</text> : null}
              {reviewedValue > 0 ? <text x={x + barWidth / 2 + 1} y={Math.max(chartTop + 7, baseY - reviewedHeight - 4)} textAnchor="middle" fontSize="8" fill="#7c3aed">{reviewedValue}</text> : null}
              {commitValue > 0 ? <text x={x + barWidth * 1.5 + 4} y={Math.max(chartTop + 7, baseY - commitHeight - 4)} textAnchor="middle" fontSize="8" fill="#1d4ed8">{commitValue}</text> : null}
              <text x={x} y={baseY + 15} textAnchor="middle" fontSize="8.5" fill="#78716c">{formatMonth(month)}</text>
            </g>
          );
        })}
        <text x={left + plotWidth / 2} y={height - 5} textAnchor="middle" fontSize="9" fill="#78716c">Month</text>
        {hover ? <ChartTooltip hover={hover} left={left} right={left + plotWidth} /> : null}
      </svg>
    </div>
  );
}
