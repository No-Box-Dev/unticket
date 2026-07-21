/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useOpenPRs,
  useMergedPRs,
  useIsAdmin,
  useActiveMembers,
  useEngineerStats,
} from "@/hooks/useGitHub";
import { useAuth } from "@/lib/auth";
import { useFeedProjects } from "@/hooks/useNoxlink";
import {
  ArrowLeft,
  CircleCheck,
  ExternalLink,
  Folder,
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
export function CurrentTab({ repoNames, navFilter }: CurrentTabProps) {
  const [searchParams, setSearchParams] = useSearchParams();
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
    return list;
  }, [prs, archivedRepos, view]);

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
          members={members ?? []}
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
          members={members ?? []}
          repos={activeRepoNames}
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
  const cards = [
    { label: "Lifetime PRs", value: stats?.lifetimePRs?.[login] ?? 0, icon: <GitPullRequest size={14} className="text-stone-400" /> },
    { label: "PRs · last 4 weeks", value: stats?.prsLast4Weeks?.[login] ?? 0, icon: <GitMerge size={14} className="text-stone-400" /> },
    { label: "Approvals given", value: stats?.approvalsGiven?.[login] ?? 0, icon: <CircleCheck size={14} className="text-stone-400" /> },
    { label: "Merged for others", value: stats?.mergesOfOthers?.[login] ?? 0, icon: <GitMerge size={14} className="text-stone-400" /> },
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
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-white border border-stone-200 rounded-xl p-4">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-stone-400 uppercase tracking-wider">
            {c.icon}
            <span>{c.label}</span>
          </div>
          <div className="text-2xl font-bold font-display text-stone-800 mt-2 leading-none">{c.value}</div>
        </div>
      ))}
    </div>
  );
}
