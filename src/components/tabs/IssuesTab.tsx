/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  useOpenIssues,
  useClosedIssues,
  useActiveMembers,
  useUpdateIssueAssignees,
  usePaginatedIssues,
} from "@/hooks/useGitHub";
import { useFeedProjects } from "@/hooks/useNoxlink";
import {
  ArrowLeft,
  CircleCheck,
  CircleDot,
  ExternalLink,
  Flag,
  Folder,
  Users,
  UserRound,
} from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import { daysAgo, STALE_ISSUE_DAYS } from "@/lib/dates";
import { SortIcon } from "@/components/ui/SortIcon";
import { AssignDropdown } from "@/components/sprint/AssignDropdown";

type SortKey = "repo" | "title" | "assignees" | "age";
type SortDir = "asc" | "desc";
type GroupBy = "people" | "repo";
type IssueView = "open" | "closed";

const EXCLUDED_REPOS = new Set(["unticket", ".unticket"]);
const CRITICAL_LABELS = new Set(["critical"]);

function isCritical(issue: any): boolean {
  return (issue.labels ?? []).some((l: any) => CRITICAL_LABELS.has(l.name?.toLowerCase()));
}

const UNASSIGNED_KEY = "__unassigned__";

interface IssuesTabProps {
  repoNames: string[];
  navFilter?: import("@/lib/types").NavFilter | null;
}

// URL params drive navigation so links + browser-back stay coherent:
//   ?tab=issues                        — Open, grouped by People (default)
//   ?tab=issues&view=closed            — Closed (last 30d), grouped by People
//   ?tab=issues&by=repo                — grid grouped by Repo
//   ?tab=issues&assignee=<login>       — drilled into a person's issues
//   ?tab=issues&assignee=__unassigned__ — drilled into the Unassigned bucket
//   ?tab=issues&repo=<name>            — drilled into a repo's issues
export function IssuesTab({ repoNames, navFilter }: IssuesTabProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = (searchParams.get("view") as IssueView) === "closed" ? "closed" : "open";
  const groupBy = (searchParams.get("by") as GroupBy) === "repo" ? "repo" : "people";
  const drillAssignee = searchParams.get("assignee") ?? navFilter?.person ?? null;
  const drillRepo = searchParams.get("repo") ?? null;
  const isDrilled = Boolean(drillAssignee || drillRepo);

  const { data: feedProjects } = useFeedProjects();
  const { data: members } = useActiveMembers();

  const archivedRepos = useMemo(
    () => new Set((feedProjects ?? []).filter((p) => p.archived && p.repo).map((p) => p.repo!)),
    [feedProjects],
  );
  const activeRepoNames = useMemo(
    () => repoNames.filter((n) => !archivedRepos.has(n) && !EXCLUDED_REPOS.has(n)),
    [repoNames, archivedRepos],
  );

  const { data: openIssues, isLoading: openLoading } = useOpenIssues(activeRepoNames);
  const { data: closedIssues, isLoading: closedLoading } = useClosedIssues(activeRepoNames);

  const issues = view === "open" ? openIssues : closedIssues;
  const isLoading = view === "open" ? openLoading : closedLoading;

  // Drop issues from archived repos regardless of source.
  const scoped = useMemo(() => {
    const list = issues ?? [];
    if (archivedRepos.size === 0) return list;
    return list.filter((i: any) => !archivedRepos.has(i.repo));
  }, [issues, archivedRepos]);

  const setUrl = useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams);
      params.set("tab", "issues");
      for (const [k, v] of Object.entries(next)) {
        if (v == null) params.delete(k);
        else params.set(k, v);
      }
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return (
    <div className="space-y-4" data-tab="issues">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-stone-200 overflow-hidden">
          {(["open", "closed"] as IssueView[]).map((v) => (
            <button
              key={v}
              onClick={() => setUrl({ view: v === "open" ? null : v, assignee: null, repo: null })}
              className={cn(
                "px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors",
                view === v
                  ? "bg-accent text-white"
                  : "bg-white text-stone-600 hover:bg-stone-50",
                v === "closed" && "border-l border-stone-200",
              )}
            >
              {v === "open" ? "Open" : "Closed (30d)"}
            </button>
          ))}
        </div>

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
          {isLoading ? <Spinner size="sm" /> : `${scoped.length} ${view} issue${scoped.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {/* Critical banner — persists across grid and drill-in views, shows the
          org's currently-open critical issues so nobody misses them regardless
          of the grouping. Only appears on the Open view. */}
      {view === "open" && <CriticalBanner />}

      {isDrilled ? (
        <DrilledView
          issues={scoped}
          view={view}
          isLoading={isLoading}
          drillAssignee={drillAssignee}
          drillRepo={drillRepo}
          allPeople={(members ?? []).map((m) => m.login).sort()}
          onBack={() => setUrl({ assignee: null, repo: null })}
        />
      ) : isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner className="w-6 h-6 text-accent" />
        </div>
      ) : scoped.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-200 bg-white/50 px-6 py-16 text-center text-sm text-stone-500">
          No {view} issues.
        </div>
      ) : (
        <CardGrid
          issues={scoped}
          groupBy={groupBy}
          view={view}
          members={members ?? []}
          onOpen={(key) =>
            setUrl(groupBy === "people" ? { assignee: key, repo: null } : { repo: key, assignee: null })
          }
        />
      )}
    </div>
  );
}

// ---------- Card grid ----------

interface Bucket {
  key: string;
  label: string;
  isUnassigned: boolean;
  avatarUrl: string | null;
  count: number;
  criticalCount: number;
  staleCount: number;
  avgAgeDays: number;
  newestUpdatedAt: string;
}

interface CardGridProps {
  issues: any[];
  groupBy: GroupBy;
  view: IssueView;
  members: { login: string; avatar_url: string }[];
  onOpen: (key: string) => void;
}

function CardGrid({ issues, groupBy, view, members, onOpen }: CardGridProps) {
  const avatarByLogin = useMemo(() => {
    const m = new Map<string, string>();
    members.forEach((mem) => m.set(mem.login, mem.avatar_url));
    return m;
  }, [members]);

  const buckets = useMemo<Bucket[]>(() => {
    const map = new Map<string, {
      key: string; label: string; isUnassigned: boolean; avatarUrl: string | null;
      ages: number[]; critical: number; stale: number; newest: string; ids: Set<number>;
    }>();

    const ensure = (key: string, label: string, isUnassigned: boolean, avatarUrl: string | null, updatedAt: string) => {
      if (!map.has(key)) {
        map.set(key, {
          key, label, isUnassigned, avatarUrl,
          ages: [], critical: 0, stale: 0, newest: updatedAt, ids: new Set(),
        });
      }
      return map.get(key)!;
    };

    for (const issue of issues) {
      const upd = issue.updated_at ?? issue.created_at;
      const age = daysAgo(issue.created_at);
      const crit = isCritical(issue) ? 1 : 0;
      const stale = age > STALE_ISSUE_DAYS ? 1 : 0;

      // A person-grouped card counts an issue for EVERY assignee it has, so a
      // 3-assignee issue shows up in all three cards. Unassigned issues land
      // in the synthetic "Unassigned" bucket. Repo-grouped is a plain 1:1.
      if (groupBy === "people") {
        const assignees = (issue.assignees ?? []) as { login: string; avatar_url?: string }[];
        if (assignees.length === 0) {
          const b = ensure(UNASSIGNED_KEY, "Unassigned", true, null, upd);
          if (!b.ids.has(issue.id)) {
            b.ids.add(issue.id);
            b.ages.push(age);
            b.critical += crit;
            b.stale += stale;
            if (upd > b.newest) b.newest = upd;
          }
        } else {
          for (const a of assignees) {
            const b = ensure(
              a.login,
              a.login,
              false,
              avatarByLogin.get(a.login) ?? a.avatar_url ?? null,
              upd,
            );
            if (!b.ids.has(issue.id)) {
              b.ids.add(issue.id);
              b.ages.push(age);
              b.critical += crit;
              b.stale += stale;
              if (upd > b.newest) b.newest = upd;
            }
          }
        }
      } else {
        const repo = issue.repo ?? "(unknown)";
        const b = ensure(repo, repo, false, null, upd);
        if (!b.ids.has(issue.id)) {
          b.ids.add(issue.id);
          b.ages.push(age);
          b.critical += crit;
          b.stale += stale;
          if (upd > b.newest) b.newest = upd;
        }
      }
    }

    return Array.from(map.values()).map((b) => ({
      key: b.key,
      label: b.label,
      isUnassigned: b.isUnassigned,
      avatarUrl: b.avatarUrl,
      count: b.ids.size,
      criticalCount: b.critical,
      staleCount: b.stale,
      avgAgeDays: b.ages.length ? Math.round(b.ages.reduce((a, c) => a + c, 0) / b.ages.length) : 0,
      newestUpdatedAt: b.newest,
    }));
  }, [issues, groupBy, avatarByLogin]);

  // Sort by count descending (user's explicit ask), tiebreak by most-recent
  // activity. Unassigned stays at the top so triage attention doesn't
  // depend on how many issues someone happened to leave for later.
  const sorted = useMemo(() => {
    return [...buckets].sort((a, b) => {
      if (a.isUnassigned && !b.isUnassigned) return -1;
      if (!a.isUnassigned && b.isUnassigned) return 1;
      if (b.count !== a.count) return b.count - a.count;
      return b.newestUpdatedAt.localeCompare(a.newestUpdatedAt);
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
  bucket: Bucket; groupBy: GroupBy; view: IssueView; onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className={cn(
        "bg-white border rounded-xl p-4 text-left transition-colors cursor-pointer flex flex-col gap-3",
        bucket.isUnassigned
          ? "border-amber-200 hover:border-amber-300 hover:bg-amber-50/40"
          : "border-stone-200 hover:border-stone-300 hover:bg-stone-50/50",
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        {groupBy === "people" ? (
          bucket.isUnassigned ? (
            <div className="w-10 h-10 rounded-full bg-amber-100 shrink-0 flex items-center justify-center text-amber-600">
              <UserRound size={18} />
            </div>
          ) : bucket.avatarUrl ? (
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
            {view === "open" ? "Open issues" : "Closed (30d)"}
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
        {view === "open" && bucket.criticalCount > 0 && (
          <div className="flex items-baseline gap-1 text-red-600">
            <span className="text-lg font-semibold font-display tabular-nums">
              {bucket.criticalCount}
            </span>
            <span className="text-[10px] uppercase tracking-wider">critical</span>
          </div>
        )}
        {view === "open" && bucket.staleCount > 0 && (
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

// ---------- Critical banner ----------

function CriticalBanner() {
  // Loaded independently so the banner is available even inside a drill-in
  // and doesn't rely on the caller's filtered view.
  const { data } = usePaginatedIssues({
    state: "open",
    page: 1,
    pageSize: 50,
    label: "critical",
    sort: "created_at",
    sortDir: "desc",
  });
  const criticals = (data?.data ?? []) as any[];
  if (criticals.length === 0) return null;

  return (
    <div className="rounded-xl border border-red-200 bg-red-50/40 px-4 py-3 flex items-center gap-3">
      <Flag className="w-4 h-4 text-red-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-red-700 uppercase tracking-wider">
          {criticals.length} critical issue{criticals.length === 1 ? "" : "s"} open
        </div>
        <div className="text-xs text-stone-500 truncate">
          {criticals.slice(0, 3).map((i: any) => `${i.repo}#${i.number}`).join(" · ")}
          {criticals.length > 3 && ` · +${criticals.length - 3} more`}
        </div>
      </div>
      <Link
        to="/issues/label/critical"
        className="text-xs font-medium text-red-600 hover:text-red-700 whitespace-nowrap"
      >
        View all →
      </Link>
    </div>
  );
}

// ---------- Drilled-in list ----------

interface DrilledViewProps {
  issues: any[];
  view: IssueView;
  isLoading: boolean;
  drillAssignee: string | null;
  drillRepo: string | null;
  allPeople: string[];
  onBack: () => void;
}

function DrilledView({ issues, view, isLoading, drillAssignee, drillRepo, allPeople, onBack }: DrilledViewProps) {
  const navigate = useNavigate();
  const updateAssignees = useUpdateIssueAssignees();

  const [sortKey, setSortKey] = useState<SortKey>("age");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filtered = useMemo(() => {
    return issues.filter((issue: any) => {
      if (drillAssignee) {
        const assignees = (issue.assignees ?? []) as { login: string }[];
        if (drillAssignee === UNASSIGNED_KEY) {
          if (assignees.length > 0) return false;
        } else if (!assignees.some((a) => a.login === drillAssignee)) {
          return false;
        }
      }
      if (drillRepo && issue.repo !== drillRepo) return false;
      return true;
    });
  }, [issues, drillAssignee, drillRepo]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a: any, b: any) => {
      switch (sortKey) {
        case "repo":
          return dir * (a.repo ?? "").localeCompare(b.repo ?? "");
        case "title":
          return dir * a.title.localeCompare(b.title);
        case "assignees":
          return dir * ((a.assignees?.length ?? 0) - (b.assignees?.length ?? 0));
        case "age":
          return dir * (daysAgo(a.created_at) - daysAgo(b.created_at));
        default:
          return 0;
      }
    });
    // Bubble critical open issues to the top regardless of sort — this is
    // triage UX not sort UX; user-selected sort still orders within each group.
    if (view === "open") {
      list.sort((a: any, b: any) => (isCritical(b) ? 1 : 0) - (isCritical(a) ? 1 : 0));
    }
    return list;
  }, [filtered, sortKey, sortDir, view]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const scopeLabel = drillAssignee === UNASSIGNED_KEY
    ? "Unassigned"
    : drillAssignee
      ? `@${drillAssignee}`
      : drillRepo ?? "";

  return (
    <div className="space-y-3">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to all issues
      </button>

      <h2 className="text-lg font-semibold text-stone-800">
        {scopeLabel}
        <span className="ml-2 text-xs font-normal text-stone-400">
          {sorted.length} {view} issue{sorted.length === 1 ? "" : "s"}
        </span>
      </h2>

      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 text-left">
              <th className="px-3 py-2.5 w-8"></th>
              <th onClick={() => toggleSort("repo")} className="px-3 py-2.5 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700">
                Issue <SortIcon column="repo" activeSortKey={sortKey} activeSortDirection={sortDir} />
              </th>
              <th onClick={() => toggleSort("title")} className="px-3 py-2.5 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700">
                Title <SortIcon column="title" activeSortKey={sortKey} activeSortDirection={sortDir} />
              </th>
              <th onClick={() => toggleSort("assignees")} className="px-3 py-2.5 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700">
                Assignees <SortIcon column="assignees" activeSortKey={sortKey} activeSortDirection={sortDir} />
              </th>
              <th onClick={() => toggleSort("age")} className="px-3 py-2.5 text-xs font-medium text-stone-500 text-right cursor-pointer hover:text-stone-700">
                Age <SortIcon column="age" activeSortKey={sortKey} activeSortDirection={sortDir} />
              </th>
              <th className="px-3 py-2.5 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center">
                  <Spinner className="mx-auto" />
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-stone-400">
                  No issues found.
                </td>
              </tr>
            ) : (
              sorted.map((issue: any) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  closed={view === "closed"}
                  allPeople={allPeople}
                  onAssign={(assignees) => updateAssignees.mutate({ repo: issue.repo, issueNumber: issue.number, assignees })}
                  onOpen={() => navigate(`/issues/${issue.repo}/${issue.number}`)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IssueRow({
  issue, closed, allPeople, onAssign, onOpen,
}: {
  issue: any;
  closed: boolean;
  allPeople: string[];
  onAssign: (assignees: string[]) => void;
  onOpen: () => void;
}) {
  const age = daysAgo(issue.created_at);
  return (
    <tr
      onClick={onOpen}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      className={cn(
        "hover:bg-stone-50 cursor-pointer focus:outline-none focus:bg-stone-50",
        closed && "text-stone-400",
        !closed && isCritical(issue) && "bg-red-50/40",
      )}
    >
      <td className="px-3 py-2">
        {closed ? (
          <CircleCheck className="w-4 h-4 text-accent" />
        ) : isCritical(issue) ? (
          <Flag className="w-4 h-4 text-red-500" />
        ) : (
          <CircleDot className="w-4 h-4 text-green-600" />
        )}
      </td>
      <td className="px-3 py-2 text-stone-500 whitespace-nowrap text-xs">
        {issue.repo && (
          <Link
            to={`/issues/repo/${issue.repo}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-accent hover:underline"
          >
            {issue.repo}
          </Link>
        )}
        {" "}#{issue.number}
      </td>
      <td className="px-3 py-2 max-w-md truncate text-stone-800">{issue.title}</td>
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <AssignDropdown
          owners={(issue.assignees ?? []).map((a: any) => a.login)}
          allPeople={allPeople}
          onChange={onAssign}
        />
      </td>
      <td
        className={cn(
          "px-3 py-2 text-right tabular-nums",
          age > STALE_ISSUE_DAYS && !closed ? "text-amber-600 font-medium" : "text-stone-400",
        )}
      >
        {age}d
      </td>
      <td className="px-3 py-2">
        <a
          href={issue.html_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-stone-300 hover:text-accent"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </td>
    </tr>
  );
}
