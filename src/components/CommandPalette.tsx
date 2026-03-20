import { useState, useEffect, useRef, useMemo } from "react";
import { Search } from "lucide-react";
import { useFeatures, usePeople, useTodos, useSprint, useAllSprintSubIssues } from "@/hooks/useConfigRepo";
import { useActiveMembers } from "@/hooks/useGitHub";
import { cn } from "@/lib/cn";
import { useTheme } from "@/lib/theme";
import { useSidebar } from "@/lib/sidebar";
import type { TabId } from "@/lib/types";

interface CommandPaletteProps {
  onNavigate: (tab: TabId) => void;
}

interface SearchResult {
  type: "feature" | "person" | "tab" | "todo" | "task" | "role" | "action";
  label: string;
  detail?: string;
  action: () => void;
}

const TAB_ITEMS: { id: TabId; label: string; keywords: string }[] = [
  { id: "overview", label: "Overview", keywords: "overview dashboard summary home" },
  { id: "sprint", label: "Sprint Board", keywords: "sprint kanban board features" },
  { id: "backlog", label: "Future Features", keywords: "backlog future" },
  { id: "prs", label: "Pull Requests", keywords: "prs pull requests" },
  { id: "issues", label: "Issues", keywords: "issues bugs" },
  { id: "todos", label: "Todos", keywords: "todos tasks personal" },
  { id: "engineers", label: "Engineers", keywords: "engineers people team members" },
  { id: "workload", label: "Workload", keywords: "workload distribution points capacity analytics" },
  { id: "settings", label: "Settings", keywords: "settings admin config teams webhook" },
];

export function CommandPalette({ onNavigate }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: features } = useFeatures();
  const { data: people } = usePeople();
  const { data: orgMembers } = useActiveMembers();
  const { data: todos } = useTodos();
  const { data: sprint } = useSprint();
  const { dark, toggle: toggleTheme } = useTheme();
  const { setViewingSprint } = useSidebar();

  // Sprint sub-issues for task/role search
  const sprintFeatureIds = useMemo(() => {
    if (!features || !sprint) return [];
    return features.filter((f) => f.sprint === sprint.number).map((f) => f.id);
  }, [features, sprint]);
  const { data: allTasks } = useAllSprintSubIssues(sprintFeatureIds);

  // Build people lookup (org members + configured people)
  const allPeople = useMemo(() => {
    const peopleMap = new Map((people ?? []).map((p) => [p.github, p]));
    const members = orgMembers ?? [];
    return members.map((m: any) => {
      const person = peopleMap.get(m.login);
      return {
        login: m.login,
        name: person?.name ?? m.login,
        role: person?.role ?? "",
        avatar_url: m.avatar_url,
      };
    });
  }, [people, orgMembers]);

  // Unique roles from tasks
  const roles = useMemo(() => {
    if (!allTasks) return [];
    const roleMap = new Map<number, { number: number; name: string; featureTitle: string; assignees: Set<string>; taskCount: number; doneCount: number }>();
    for (const t of allTasks) {
      if (!t.roleNumber) continue;
      const r = roleMap.get(t.roleNumber) ?? { number: t.roleNumber, name: t.roleName ?? `Role #${t.roleNumber}`, featureTitle: t.featureTitle, assignees: new Set(), taskCount: 0, doneCount: 0 };
      for (const a of t.assignees) r.assignees.add(a);
      r.taskCount++;
      if (t.state === "closed") r.doneCount++;
      roleMap.set(t.roleNumber, r);
    }
    return Array.from(roleMap.values());
  }, [allTasks]);

  // CMD+K to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const results = useMemo((): SearchResult[] => {
    const q = query.toLowerCase().trim();
    if (!q) {
      return [
        ...TAB_ITEMS.map((t) => ({
          type: "tab" as const,
          label: t.label,
          action: () => { onNavigate(t.id); setOpen(false); },
        })),
        {
          type: "action" as const,
          label: dark ? "Switch to Light Mode" : "Switch to Dark Mode",
          detail: `Currently ${dark ? "dark" : "light"}`,
          action: () => { toggleTheme(); setOpen(false); },
        },
      ];
    }

    const items: SearchResult[] = [];

    // Search features
    for (const f of features ?? []) {
      if (items.length >= 30) break;
      const searchText = `${f.title} ${f.owners.join(" ")}`.toLowerCase();
      if (searchText.includes(q)) {
        items.push({
          type: "feature",
          label: f.title,
          detail: [
            f.sprint ? `Sprint ${f.sprint}` : "Backlog",
            f.owners.length > 0 ? f.owners.join(", ") : null,
          ].filter(Boolean).join(" · "),
          action: () => {
            if (f.status === "future") {
              onNavigate("backlog");
            } else {
              setViewingSprint(null);
              onNavigate("sprint");
            }
            setOpen(false);
          },
        });
      }
    }

    // Search people
    for (const p of allPeople) {
      if (items.length >= 30) break;
      const searchText = `${p.name} ${p.login} ${p.role}`.toLowerCase();
      if (searchText.includes(q)) {
        items.push({
          type: "person",
          label: p.name || p.login,
          detail: p.role || p.login,
          action: () => { onNavigate("workload"); setOpen(false); },
        });
      }
    }

    // Search roles
    for (const r of roles) {
      if (items.length >= 30) break;
      const searchText = `${r.name} ${r.featureTitle} ${Array.from(r.assignees).join(" ")}`.toLowerCase();
      if (searchText.includes(q)) {
        items.push({
          type: "role",
          label: r.name,
          detail: `${r.featureTitle} · ${r.doneCount}/${r.taskCount} tasks · ${Array.from(r.assignees).join(", ")}`,
          action: () => {
            setViewingSprint(null);
            onNavigate("sprint");
            setOpen(false);
          },
        });
      }
    }

    // Search tasks
    for (const t of allTasks ?? []) {
      if (items.length >= 30) break;
      const searchText = `${t.title} ${t.featureTitle} ${t.assignees.join(" ")} ${t.roleName ?? ""}`.toLowerCase();
      if (searchText.includes(q)) {
        items.push({
          type: "task",
          label: t.title,
          detail: [
            t.featureTitle,
            t.roleName,
            t.assignees.join(", "),
            t.points ? `${t.points}pt` : null,
            t.state,
          ].filter(Boolean).join(" · "),
          action: () => {
            setViewingSprint(null);
            onNavigate("sprint");
            setOpen(false);
          },
        });
      }
    }

    // Search todos
    for (const t of todos ?? []) {
      if (items.length >= 30) break;
      const searchText = `${t.title} ${t.owner} ${t.status}`.toLowerCase();
      if (searchText.includes(q)) {
        items.push({
          type: "todo",
          label: t.title,
          detail: [t.owner, t.status.replace("_", " ")].filter(Boolean).join(" · "),
          action: () => { onNavigate("todos"); setOpen(false); },
        });
      }
    }

    // Search tabs
    for (const t of TAB_ITEMS) {
      if (t.label.toLowerCase().includes(q) || t.keywords.includes(q)) {
        items.push({
          type: "tab",
          label: t.label,
          action: () => { onNavigate(t.id); setOpen(false); },
        });
      }
    }

    // Theme toggle action
    const themeKeywords = "theme dark light night mode toggle switch appearance";
    if (themeKeywords.includes(q)) {
      items.push({
        type: "action",
        label: dark ? "Switch to Light Mode" : "Switch to Dark Mode",
        detail: `Currently ${dark ? "dark" : "light"}`,
        action: () => { toggleTheme(); setOpen(false); },
      });
    }

    return items.slice(0, 30);
  }, [query, features, allPeople, roles, allTasks, todos, sprint, onNavigate, dark, toggleTheme, setViewingSprint]);

  // Keyboard navigation
  useEffect(() => { setSelectedIndex(0); }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      e.preventDefault();
      results[selectedIndex].action();
    }
  };

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!open) return null;

  const typeColors: Record<string, string> = {
    feature: "text-brand",
    person: "text-amber-500",
    tab: "text-stone-400 dark:text-neutral-500",
    todo: "text-purple-500",
    task: "text-blue-500",
    role: "text-teal-500",
    action: "text-indigo-500",
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh]">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={() => setOpen(false)} />

      <div className="relative w-full max-w-lg bg-white dark:bg-dark-raised rounded-xl shadow-xl border border-stone-200 dark:border-white/[0.06] overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-200 dark:border-white/[0.06]">
          <Search size={16} className="text-stone-400 dark:text-neutral-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search features, people, tasks, roles, todos..."
            className="flex-1 text-sm text-stone-800 dark:text-neutral-200 placeholder:text-stone-400 dark:placeholder:text-neutral-500 outline-none bg-transparent"
          />
          <kbd className="hidden sm:inline-flex px-1.5 py-0.5 text-xs text-stone-400 dark:text-neutral-500 bg-stone-100 dark:bg-dark-overlay rounded border border-stone-200 dark:border-white/[0.06] font-mono">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-6 text-sm text-stone-400 text-center">No results</div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.type}-${r.label}-${i}`}
              onClick={r.action}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2.5 text-left cursor-pointer transition-colors",
                i === selectedIndex
                  ? "bg-stone-100 dark:bg-dark-overlay"
                  : "hover:bg-stone-50 dark:hover:bg-white/[0.06]",
              )}
            >
              <span className={cn("text-xs uppercase tracking-wider font-medium w-14 shrink-0", typeColors[r.type] ?? "text-stone-400")}>
                {r.type}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-sm text-stone-800 dark:text-neutral-200 truncate block">{r.label}</span>
                {r.detail && <span className="text-xs text-stone-400 dark:text-neutral-500">{r.detail}</span>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
