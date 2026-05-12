/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePaginatedIssues, useIssueLabels, useRepos, useActiveMembers, useUpdateIssueAssignees, useIssueStats } from "@/hooks/useGitHub";
import { useSettings } from "@/hooks/useConfigRepo";
import { useFeedProjects } from "@/hooks/useNoxlink";
import { CircleDot, CircleCheck, ExternalLink, ChevronLeft, ChevronRight, Flag } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import { daysAgo, STALE_ISSUE_DAYS } from "@/lib/dates";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { SortIcon } from "@/components/ui/SortIcon";
import { PersonSelect } from "@/components/ui/PersonSelect";
import { AssignDropdown } from "@/components/sprint/AssignDropdown";

type SortKey = "number" | "title" | "repo" | "updated_at" | "created_at";

const EXCLUDED_REPOS = new Set(["unticket", ".unticket"]);
const CRITICAL_LABELS = new Set(["critical"]);

function isCritical(issue: any): boolean {
  return (issue.labels ?? []).some((l: any) => CRITICAL_LABELS.has(l.name?.toLowerCase()));
}

const labelColors: Record<string, { bg: string; text: string }> = {
  bug: { bg: "bg-red-50  ", text: "text-red-700  " },
  enhancement: { bg: "bg-blue-50  ", text: "text-blue-700  " },
  feature: { bg: "bg-blue-50  ", text: "text-blue-700  " },
  investigation: { bg: "bg-yellow-50  ", text: "text-yellow-700  " },
  documentation: { bg: "bg-accent-light  ", text: "text-accent" },
};

function getLabelStyle(name: string, color: string) {
  const key = name.toLowerCase();
  for (const [keyword, style] of Object.entries(labelColors)) {
    if (key.includes(keyword)) return style;
  }
  return {
    bg: `bg-[#${color}20]` as string,
    text: `text-[#${color}]` as string,
  };
}

const PAGE_SIZE = 30;

const card = "bg-white  border border-stone-200  rounded-xl";

interface IssuesTabProps {
  repoNames: string[];
  navFilter?: import("@/lib/types").NavFilter | null;
}

const RECENT_WINDOW_DAYS = 30;

function recentClosedSince(): string {
  const d = new Date();
  d.setDate(d.getDate() - RECENT_WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
}

export function IssuesTab({ navFilter }: IssuesTabProps) {
  const navigate = useNavigate();
  const closedSince = useMemo(() => recentClosedSince(), []);
  const { data: settings } = useSettings();
  const { data: labels } = useIssueLabels();
  const { data: repos } = useRepos();
  const { data: members } = useActiveMembers();
  const updateAssignees = useUpdateIssueAssignees();

  const memberLogins = useMemo(() => members?.map((m) => m.login).sort() ?? [], [members]);

  const draftRepos = useMemo(() => new Set(settings?.draftRepos ?? []), [settings]);
  const { data: feedProjects } = useFeedProjects();
  const archivedRepos = useMemo(
    () => new Set((feedProjects ?? []).filter((p) => p.archived && p.repo).map((p) => p.repo!)),
    [feedProjects],
  );

  const repoList = useMemo(() => {
    return repos?.map((r: any) => r.name)
      .filter((n: string) => !EXCLUDED_REPOS.has(n) && !draftRepos.has(n) && !archivedRepos.has(n))
      .sort() ?? [];
  }, [repos, draftRepos, archivedRepos]);

  const [repoFilter, setRepoFilter] = useState<string>("all");
  const [assignmentFilter, setAssignmentFilter] = useState<"all" | "unassigned" | "assigned">(navFilter?.person ? "all" : "unassigned");
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>(navFilter?.person ? [navFilter.person] : []);
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [criticalRepoFilter, setCriticalRepoFilter] = useState<string>("all");
  const [criticalSort, setCriticalSort] = useState<{ key: "repo" | "age"; dir: "asc" | "desc" }>({ key: "age", dir: "asc" });
  const [openPage, setOpenPage] = useState(1);
  const [closedPage, setClosedPage] = useState(1);

  // Resolve repo filter → repo names
  const filteredRepos = useMemo(() => {
    if (repoFilter !== "all") {
      return [repoFilter];
    }
    return repoList.length > 0 ? repoList : undefined;
  }, [repoFilter, repoList]);

  // Stats for dashboard cards + charts (reactive to repo filter)
  const { data: stats } = useIssueStats(filteredRepos);

  // Critical issues query (all open, unfiltered by repo/assignee)
  const { data: criticalData } = usePaginatedIssues({
    state: "open",
    page: 1,
    pageSize: 50,
    label: "critical",
    sort: "created_at",
    sortDir: "desc",
  });

  // Open issues query
  const {
    data: openData,
    isLoading: openLoading,
    isFetching: openFetching,
  } = usePaginatedIssues({
    state: "open",
    page: openPage,
    pageSize: PAGE_SIZE,
    repos: filteredRepos,
    assignee: assigneeFilter.length === 1 ? assigneeFilter[0] : undefined,
    assigned: assignmentFilter === "unassigned" ? "false" : assignmentFilter === "assigned" ? "true" : undefined,
    label: labelFilter !== "all" ? labelFilter : undefined,
    sort: sortKey,
    sortDir,
  });

  // Closed issues query (recent window)
  const {
    data: closedData,
    isLoading: closedLoading,
    isFetching: closedFetching,
  } = usePaginatedIssues({
    state: "closed",
    page: closedPage,
    pageSize: PAGE_SIZE,
    repos: filteredRepos,
    assignee: assigneeFilter.length === 1 ? assigneeFilter[0] : undefined,
    assigned: assignmentFilter === "unassigned" ? "false" : assignmentFilter === "assigned" ? "true" : undefined,
    label: labelFilter !== "all" ? labelFilter : undefined,
    sort: sortKey,
    sortDir,
    closedSince,
  });

  const resetPages = () => {
    setOpenPage(1);
    setClosedPage(1);
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    resetPages();
  };

  const labelList = useMemo(() => {
    return labels?.map((l) => l.name).sort() ?? [];
  }, [labels]);

  const openTotal = openData?.totalCount ?? 0;
  const closedTotal = closedData?.totalCount ?? 0;
  const openPages = Math.ceil(openTotal / PAGE_SIZE);
  const closedPages = Math.ceil(closedTotal / PAGE_SIZE);

  const isLoading = openLoading || closedLoading;

  // Compute max for repo bar chart
  const byRepo = stats?.byRepo;
  const repoMax = useMemo(() => {
    if (!byRepo?.length) return 1;
    return Math.max(...byRepo.map((r) => r.count), 1);
  }, [byRepo]);

  return (
    <div className="space-y-6" data-tab="issues">
      {/* ──── Charts Row ──── */}
      <div className="grid grid-cols-1 gap-4">
        {/* Issues by Repo */}
        <div className={cn(card, "p-5")}>
          <h3 className="text-xs font-medium text-stone-500 uppercase tracking-wider mb-4">Open Issues by Repo</h3>
          {!stats?.byRepo?.length ? (
            <p className="text-xs text-stone-400">No data</p>
          ) : (
            <div className="space-y-2">
              {stats.byRepo.map((r) => {
                // Mutually exclusive: critical first, then stale (non-critical), then normal = remainder.
                const normal = Math.max(0, r.count - r.critical - r.stale);
                const normalPct = (normal / repoMax) * 100;
                const stalePct = (r.stale / repoMax) * 100;
                const criticalPct = (r.critical / repoMax) * 100;
                return (
                  <Link
                    key={r.repo}
                    to={`/issues/repo/${r.repo}`}
                    className="flex items-center gap-3 -mx-2 px-2 py-0.5 rounded hover:bg-stone-50 group"
                    title={`Open issues in ${r.repo}`}
                  >
                    <span className="text-xs text-stone-600 w-28 truncate shrink-0 group-hover:text-accent" title={`${r.repo} — ${r.count} open`}>{r.repo}</span>
                    <div className="flex-1 h-5 bg-stone-100 rounded overflow-hidden flex">
                      {normal > 0 && (
                        <div
                          className="h-full bg-stone-400 transition-all duration-300"
                          style={{ width: `${normalPct}%` }}
                          title={`${normal} open (not stale, not critical)`}
                        />
                      )}
                      {r.stale > 0 && (
                        <div
                          className="h-full bg-amber-200 transition-all duration-300"
                          style={{ width: `${stalePct}%` }}
                          title={`${r.stale} stale (>30d)`}
                        />
                      )}
                      {r.critical > 0 && (
                        <div
                          className="h-full bg-red-300 transition-all duration-300"
                          style={{ width: `${criticalPct}%` }}
                          title={`${r.critical} critical`}
                        />
                      )}
                    </div>
                    <span className="text-xs font-medium text-stone-700 w-8 text-right tabular-nums shrink-0">{r.count}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {/* ──── Critical Issues ──── */}
      {(criticalData?.data ?? []).length > 0 && (() => {
        const criticalIssues = criticalData!.data as any[];
        const repoCountMap = new Map<string, number>();
        for (const issue of criticalIssues) {
          repoCountMap.set(issue.repo, (repoCountMap.get(issue.repo) ?? 0) + 1);
        }
        const repoOptions = [...repoCountMap.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([repo, count]) => ({ repo, count }));
        const filtered = criticalRepoFilter === "all"
          ? criticalIssues
          : criticalIssues.filter((i: any) => i.repo === criticalRepoFilter);
        const sorted = [...filtered].sort((a, b) => {
          if (criticalSort.key === "repo") {
            const cmp = a.repo.localeCompare(b.repo);
            return criticalSort.dir === "asc" ? cmp : -cmp;
          }
          const ageA = daysAgo(a.created_at);
          const ageB = daysAgo(b.created_at);
          return criticalSort.dir === "asc" ? ageA - ageB : ageB - ageA;
        });
        const toggleCriticalSort = (key: "repo" | "age") => {
          setCriticalSort((prev) =>
            prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
          );
        };

        return (
          <div className={cn(card, "overflow-hidden border-l-[3px] border-l-red-500")}>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-100">
              <Flag className="w-4 h-4 text-red-500" />
              <h3 className="text-xs font-medium text-red-600 uppercase tracking-wider">
                Critical Issues ({criticalData!.totalCount})
              </h3>
              <select
                value={criticalRepoFilter}
                onChange={(e) => setCriticalRepoFilter(e.target.value)}
                className="ml-auto px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-stone-200 text-stone-600 cursor-pointer focus:outline-none focus:border-red-400"
              >
                <option value="all">All Repos ({criticalIssues.length})</option>
                {repoOptions.map(({ repo, count }) => (
                  <option key={repo} value={repo}>{repo} ({count})</option>
                ))}
              </select>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-stone-100 text-left">
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-3 py-2 text-xs font-medium text-stone-500">Issue</th>
                  <th className="px-3 py-2 text-xs font-medium text-stone-500">Title</th>
                  <th
                    onClick={() => toggleCriticalSort("repo")}
                    className="px-3 py-2 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700"
                  >
                    Repo <SortIcon column="repo" activeSortKey={criticalSort.key} activeSortDirection={criticalSort.dir} />
                  </th>
                  <th className="px-3 py-2 text-xs font-medium text-stone-500">Assignees</th>
                  <th
                    onClick={() => toggleCriticalSort("age")}
                    className="px-3 py-2 text-xs font-medium text-stone-500 text-right cursor-pointer hover:text-stone-700"
                  >
                    Age <SortIcon column="age" activeSortKey={criticalSort.key} activeSortDirection={criticalSort.dir} />
                  </th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {sorted.map((issue: any) => (
                  <tr
                    key={issue.id}
                    onClick={() => navigate(`/issues/${issue.repo}/${issue.number}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(`/issues/${issue.repo}/${issue.number}`);
                      }
                    }}
                    tabIndex={0}
                    className="hover:bg-red-50/50 cursor-pointer focus:bg-red-50/50 focus:outline-none"
                  >
                    <td className="px-3 py-2">
                      <Flag className="w-4 h-4 text-red-500" />
                    </td>
                    <td className="px-3 py-2 text-stone-500 whitespace-nowrap">#{issue.number}</td>
                    <td className="px-3 py-2 max-w-md truncate text-stone-800">{issue.title}</td>
                    <td className="px-3 py-2 text-stone-500">
                      <Link
                        to={`/issues/repo/${issue.repo}`}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:text-accent hover:underline"
                      >
                        {issue.repo}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-stone-500">
                      {(issue.assignees ?? []).length > 0
                        ? (issue.assignees as any[]).map((a: any) => a.login).join(", ")
                        : <span className="text-stone-300">—</span>
                      }
                    </td>
                    <td className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      daysAgo(issue.created_at) > 7 ? "text-red-500 font-medium" : "text-stone-400  ",
                    )}>
                      {daysAgo(issue.created_at)}d
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
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* ──── Issue List ──── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-stone-800">All Issues</h3>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="flex items-center bg-stone-100 rounded-lg p-0.5">
            {(["all", "unassigned", "assigned"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => { setAssignmentFilter(opt); resetPages(); }}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded-md transition-colors capitalize",
                  assignmentFilter === opt
                    ? "bg-white  text-stone-800  shadow-sm"
                    : "text-stone-500  hover:text-stone-700  ",
                )}
              >
                {opt}
              </button>
            ))}
          </div>

          <PersonSelect
            value={assigneeFilter.length > 0 ? assigneeFilter : null}
            onChange={(v) => {
              setAssigneeFilter(Array.isArray(v) ? v : v ? [v] : []);
              resetPages();
            }}
            options={memberLogins.map((l) => ({ value: l, label: l }))}
            placeholder="All Assignees"
            multi
          />

          <SearchableSelect
            value={repoFilter}
            onChange={(v) => {
              setRepoFilter(v);
              resetPages();
            }}
            options={[
              { value: "all", label: "All Repos" },
              ...repoList.map((r) => ({ value: r, label: r })),
            ]}
            placeholder="All Repos"
          />

          <select
            value={labelFilter}
            onChange={(e) => {
              setLabelFilter(e.target.value);
              resetPages();
            }}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-stone-200 text-stone-600 cursor-pointer focus:outline-none focus:border-accent"
          >
            <option value="all">All Labels</option>
            {labelList.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>

          <span className="text-xs text-stone-400 ml-auto">
            {openTotal} open, {closedTotal} closed
          </span>
        </div>

        {/* Table */}
        <div className={cn(card, "overflow-hidden")}>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-stone-100 text-left">
                <th className="px-3 py-2 w-8"></th>
                <th
                  onClick={() => toggleSort("number")}
                  className="px-3 py-2 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700"
                >
                  Issue <SortIcon column="number" activeSortKey={sortKey} activeSortDirection={sortDir} />
                </th>
                <th
                  onClick={() => toggleSort("title")}
                  className="px-3 py-2 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700"
                >
                  Title <SortIcon column="title" activeSortKey={sortKey} activeSortDirection={sortDir} />
                </th>
                <th
                  onClick={() => toggleSort("repo")}
                  className="px-3 py-2 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700"
                >
                  Repo <SortIcon column="repo" activeSortKey={sortKey} activeSortDirection={sortDir} />
                </th>
                <th className="px-3 py-2 text-xs font-medium text-stone-500">Labels</th>
                <th className="px-3 py-2 text-xs font-medium text-stone-500">Assignees</th>
                <th
                  onClick={() => toggleSort("created_at")}
                  className="px-3 py-2 text-xs font-medium text-stone-500 text-right cursor-pointer hover:text-stone-700"
                >
                  Age <SortIcon column="created_at" activeSortKey={sortKey} activeSortDirection={sortDir} />
                </th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center">
                    <Spinner className="mx-auto" />
                  </td>
                </tr>
              ) : openTotal === 0 && closedTotal === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-stone-400">
                    No issues found
                  </td>
                </tr>
              ) : (
                <>
                  {[...(openData?.data ?? [])].sort((a, b) => (isCritical(b) ? 1 : 0) - (isCritical(a) ? 1 : 0)).map((issue) => (
                    <IssueRow key={issue.id} issue={issue} closed={false} allPeople={memberLogins} onAssign={(assignees) => updateAssignees.mutate({ repo: issue.repo, issueNumber: issue.number, assignees })} />
                  ))}

                  {openPages > 1 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-2">
                        <PaginationControls
                          page={openPage}
                          totalPages={openPages}
                          onPageChange={setOpenPage}
                          isFetching={openFetching}
                        />
                      </td>
                    </tr>
                  )}

                  {closedTotal > 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-2 text-xs font-medium text-stone-400 uppercase tracking-wider bg-stone-50 border-t-2 border-stone-200"
                      >
                        Closed Recently (30d)
                      </td>
                    </tr>
                  )}

                  {(closedData?.data ?? []).map((issue) => (
                    <IssueRow key={issue.id} issue={issue} closed allPeople={memberLogins} onAssign={(assignees) => updateAssignees.mutate({ repo: issue.repo, issueNumber: issue.number, assignees })} />
                  ))}

                  {closedPages > 1 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-2">
                        <PaginationControls
                          page={closedPage}
                          totalPages={closedPages}
                          onPageChange={setClosedPage}
                          isFetching={closedFetching}
                        />
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

// ──── Pagination ────

function PaginationControls({
  page,
  totalPages,
  onPageChange,
  isFetching,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  isFetching: boolean;
}) {
  return (
    <div className="flex items-center justify-center gap-3">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="p-1 text-stone-400 hover:text-stone-600 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className={cn("text-xs text-stone-500  tabular-nums", isFetching && "opacity-50")}>
        Page {page} of {totalPages}
      </span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="p-1 text-stone-400 hover:text-stone-600 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// ──── Issue Row ────

function IssueRow({ issue, closed, allPeople, onAssign }: { issue: any; closed: boolean; allPeople: string[]; onAssign: (assignees: string[]) => void }) {
  const navigate = useNavigate();
  const age = daysAgo(issue.created_at);
  const onActivate = () => navigate(`/issues/${issue.repo}/${issue.number}`);

  return (
    <tr
      onClick={onActivate}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onActivate();
        }
      }}
      tabIndex={0}
      className={cn(
        "hover:bg-stone-50 cursor-pointer focus:outline-none focus:bg-stone-50",
        closed && "text-stone-400  ",
        !closed && isCritical(issue) && "bg-red-50/50  ",
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
      <td className="px-3 py-2 text-stone-500 whitespace-nowrap">#{issue.number}</td>
      <td className="px-3 py-2 max-w-md truncate">{issue.title}</td>
      <td className="px-3 py-2 text-stone-500 text-xs">
        {issue.repo ? (
          <Link
            to={`/issues/repo/${issue.repo}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:text-accent hover:underline"
          >
            {issue.repo}
          </Link>
        ) : (
          "—"
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-1 flex-wrap">
          {(issue.labels ?? []).slice(0, 3).map((l: any) => {
            const style = getLabelStyle(l.name, l.color);
            return (
              <Link
                key={l.name}
                to={`/issues/label/${encodeURIComponent(l.name)}`}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "text-xs px-1.5 py-0.5 rounded-full font-medium hover:opacity-80",
                  style.bg,
                  style.text,
                )}
              >
                {l.name}
              </Link>
            );
          })}
        </div>
      </td>
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
          age > STALE_ISSUE_DAYS && !closed ? "text-amber-600 font-medium" : "text-stone-400  ",
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

