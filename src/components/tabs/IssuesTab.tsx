import { useState, useMemo } from "react";
import { useOpenIssues, useClosedIssues } from "@/hooks/useGitHub";
import { useSprint, useSettings } from "@/hooks/useConfigRepo";
import { CircleDot, CircleCheck, ExternalLink, ChevronUp, ChevronDown, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { useQueryClient } from "@tanstack/react-query";

function daysAgo(date: string): number {
  return Math.floor(
    (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24),
  );
}

type SortKey = "issue" | "title" | "repo" | "age";
type SortDir = "asc" | "desc";

const labelColors: Record<string, { bg: string; text: string }> = {
  bug: { bg: "bg-red-50", text: "text-red-700" },
  enhancement: { bg: "bg-blue-50", text: "text-blue-700" },
  feature: { bg: "bg-blue-50", text: "text-blue-700" },
  investigation: { bg: "bg-yellow-50", text: "text-yellow-700" },
  documentation: { bg: "bg-purple-50", text: "text-purple-700" },
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

interface IssuesTabProps {
  repoNames: string[];
}

export function IssuesTab({ repoNames }: IssuesTabProps) {
  const qc = useQueryClient();
  const { data: sprint } = useSprint();
  const { data: settings } = useSettings();
  const { data: openIssues, isLoading } = useOpenIssues(repoNames);
  const { data: closedIssues } = useClosedIssues(repoNames, sprint?.startDate);

  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [repoFilter, setRepoFilter] = useState<string>("all");
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("age");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const teams = useMemo(
    () => settings?.teams ?? [],
    [settings],
  );

  // Build repo→team lookup
  const repoToTeam = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teams) {
      for (const r of t.repos ?? []) {
        map.set(r, t.name);
      }
    }
    return map;
  }, [teams]);

  const openWithRepo = openIssues ?? [];
  const closedWithRepo = closedIssues ?? [];

  // Unique repos and labels for dropdowns
  const repos = useMemo(() => {
    const set = new Set<string>();
    for (const i of [...openWithRepo, ...closedWithRepo]) {
      if ((i as any).repo) set.add((i as any).repo);
    }
    return Array.from(set).sort();
  }, [openWithRepo, closedWithRepo]);

  const labels = useMemo(() => {
    const set = new Set<string>();
    for (const i of [...openWithRepo, ...closedWithRepo]) {
      for (const l of i.labels ?? []) {
        set.add((l as any).name);
      }
    }
    return Array.from(set).sort();
  }, [openWithRepo, closedWithRepo]);

  const filterIssues = (list: any[]) => {
    let result = list;
    if (teamFilter !== "all") {
      result = result.filter((i) => repoToTeam.get(i.repo) === teamFilter);
    }
    if (repoFilter !== "all") {
      result = result.filter((i) => i.repo === repoFilter);
    }
    if (labelFilter !== "all") {
      result = result.filter((i) =>
        (i.labels ?? []).some((l: any) => l.name === labelFilter),
      );
    }
    return result;
  };

  const sortIssues = (list: any[]) => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "issue":
          return dir * (a.number - b.number);
        case "title":
          return dir * a.title.localeCompare(b.title);
        case "repo":
          return dir * (a.repo ?? "").localeCompare(b.repo ?? "");
        case "age":
          return dir * (daysAgo(a.created_at) - daysAgo(b.created_at));
        default:
          return 0;
      }
    });
  };

  const filteredOpen = sortIssues(filterIssues(openWithRepo));
  const filteredClosed = sortIssues(filterIssues(closedWithRepo));

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortDir === "asc" ? (
      <ChevronUp className="w-3 h-3 inline ml-0.5" />
    ) : (
      <ChevronDown className="w-3 h-3 inline ml-0.5" />
    );
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["issues"] });
    qc.invalidateQueries({ queryKey: ["closedIssues"] });
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {teams.length > 1 && (
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-stone-200 text-stone-600 cursor-pointer focus:outline-none focus:border-brand"
          >
            <option value="all">All Teams</option>
            {teams.map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
        )}

        <select
          value={repoFilter}
          onChange={(e) => setRepoFilter(e.target.value)}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-stone-200 text-stone-600 cursor-pointer focus:outline-none focus:border-brand"
        >
          <option value="all">All Repos</option>
          {repos.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>

        <select
          value={labelFilter}
          onChange={(e) => setLabelFilter(e.target.value)}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-stone-200 text-stone-600 cursor-pointer focus:outline-none focus:border-brand"
        >
          <option value="all">All Labels</option>
          {labels.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>

        <button
          onClick={refresh}
          className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-brand cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>

        <span className="text-xs text-stone-400 ml-auto">
          {filteredOpen.length} open, {filteredClosed.length} closed
        </span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 text-left">
              <th className="px-4 py-2.5 w-8"></th>
              <th
                onClick={() => toggleSort("issue")}
                className="px-4 py-2.5 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700"
              >
                Issue <SortIcon col="issue" />
              </th>
              <th
                onClick={() => toggleSort("title")}
                className="px-4 py-2.5 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700"
              >
                Title <SortIcon col="title" />
              </th>
              <th className="px-4 py-2.5 text-xs font-medium text-stone-500">Team</th>
              <th
                onClick={() => toggleSort("repo")}
                className="px-4 py-2.5 text-xs font-medium text-stone-500 cursor-pointer hover:text-stone-700"
              >
                Repo <SortIcon col="repo" />
              </th>
              <th className="px-4 py-2.5 text-xs font-medium text-stone-500">Labels</th>
              <th className="px-4 py-2.5 text-xs font-medium text-stone-500">Assignees</th>
              <th
                onClick={() => toggleSort("age")}
                className="px-4 py-2.5 text-xs font-medium text-stone-500 text-right cursor-pointer hover:text-stone-700"
              >
                Age <SortIcon col="age" />
              </th>
              <th className="px-4 py-2.5 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {isLoading ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-stone-400">
                  Loading issues...
                </td>
              </tr>
            ) : filteredOpen.length === 0 && filteredClosed.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-stone-400">
                  No issues found
                </td>
              </tr>
            ) : (
              <>
                {filteredOpen.map((issue) => (
                  <IssueRow key={issue.id} issue={issue} closed={false} teams={teams} />
                ))}

                {filteredClosed.length > 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-2 text-[10px] font-medium text-stone-400 uppercase tracking-wider bg-stone-50 border-t-2 border-stone-200"
                    >
                      Closed During Sprint
                    </td>
                  </tr>
                )}

                {filteredClosed.map((issue) => (
                  <IssueRow key={issue.id} issue={issue} closed teams={teams} />
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IssueRow({ issue, closed, teams }: { issue: any; closed: boolean; teams: { name: string; color: string; repos: string[] }[] }) {
  const age = daysAgo(issue.created_at);
  const team = teams.find((t) => (t.repos ?? []).includes(issue.repo));

  return (
    <tr className={cn("hover:bg-stone-50", closed && "text-stone-400")}>
      <td className="px-4 py-2.5">
        {closed ? (
          <CircleCheck className="w-4 h-4 text-purple-500" />
        ) : (
          <CircleDot className="w-4 h-4 text-green-600" />
        )}
      </td>
      <td className="px-4 py-2.5 text-stone-500 whitespace-nowrap">#{issue.number}</td>
      <td className="px-4 py-2.5 max-w-md truncate">{issue.title}</td>
      <td className="px-4 py-2.5">
        {team ? (
          <span className="flex items-center gap-1.5 text-xs text-stone-500">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: team.color }}
            />
            {team.name}
          </span>
        ) : (
          <span className="text-xs text-stone-300">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-stone-500 text-xs">{issue.repo || "—"}</td>
      <td className="px-4 py-2.5">
        <div className="flex gap-1 flex-wrap">
          {(issue.labels ?? []).slice(0, 3).map((l: any) => {
            const style = getLabelStyle(l.name, l.color);
            return (
              <span
                key={l.name}
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                  style.bg,
                  style.text,
                )}
              >
                {l.name}
              </span>
            );
          })}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex -space-x-1">
          {(issue.assignees ?? []).length === 0 ? (
            <span className="text-xs text-stone-300">none</span>
          ) : (
            (issue.assignees ?? []).map((a: any) => (
              <img
                key={a.login}
                src={a.avatar_url}
                alt={a.login}
                title={a.login}
                className="w-5 h-5 rounded-full border border-white"
              />
            ))
          )}
        </div>
      </td>
      <td
        className={cn(
          "px-4 py-2.5 text-right tabular-nums",
          age > 30 && !closed ? "text-amber-600 font-medium" : "text-stone-400",
        )}
      >
        {age}d
      </td>
      <td className="px-4 py-2.5">
        <a
          href={issue.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-stone-300 hover:text-brand"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </td>
    </tr>
  );
}
