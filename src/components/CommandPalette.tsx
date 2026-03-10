import { useState, useEffect, useRef, useMemo } from "react";
import { Search } from "lucide-react";
import { useFeatures, usePeople, useTodos, useSprint } from "@/hooks/useConfigRepo";
import { cn } from "@/lib/cn";
import { useTheme } from "@/lib/theme";
import type { TabId } from "@/lib/types";

interface CommandPaletteProps {
  onNavigate: (tab: TabId) => void;
}

interface SearchResult {
  type: "feature" | "person" | "tab" | "todo" | "task" | "action";
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
  { id: "todos", label: "Todos", keywords: "todos tasks" },
  { id: "engineers", label: "Engineers", keywords: "engineers people team members" },
  { id: "insights", label: "Insights", keywords: "insights metrics analytics" },
];

export function CommandPalette({ onNavigate }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: features } = useFeatures();
  const { data: people } = usePeople();
  const { data: todos } = useTodos();
  const { data: sprint } = useSprint();
  const { dark, toggle: toggleTheme } = useTheme();

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
      if (items.length >= 25) break;
      const searchText = `${f.title} ${f.owners.join(" ")} ${f.team ?? ""} ${f.priority ?? ""}`.toLowerCase();
      if (searchText.includes(q)) {
        items.push({
          type: "feature",
          label: f.title,
          detail: [
            f.sprint ? `Sprint ${f.sprint}` : "Backlog",
            f.owners.length > 0 ? f.owners.join(", ") : null,
            f.priority && f.priority !== "none" ? `${f.priority} priority` : null,
          ].filter(Boolean).join(" · "),
          action: () => {
            onNavigate(f.status === "future" ? "backlog" : "sprint");
            setOpen(false);
          },
        });
      }
    }

    // Search people
    for (const p of people ?? []) {
      if (items.length >= 25) break;
      const searchText = `${p.name} ${p.github} ${p.role} ${p.teams.join(" ")}`.toLowerCase();
      if (searchText.includes(q)) {
        items.push({
          type: "person",
          label: p.name || p.github,
          detail: [p.role, p.teams.join(", ")].filter(Boolean).join(" · "),
          action: () => { onNavigate("engineers"); setOpen(false); },
        });
      }
    }

    // Search todos
    for (const t of todos ?? []) {
      if (items.length >= 25) break;
      const searchText = `${t.title} ${t.owner} ${t.repo ?? ""} ${t.status}`.toLowerCase();
      if (searchText.includes(q)) {
        items.push({
          type: "todo",
          label: t.title,
          detail: [t.owner, t.status.replace("_", " "), t.repo].filter(Boolean).join(" · "),
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

    return items.slice(0, 25);
  }, [query, features, people, todos, sprint, onNavigate, dark, toggleTheme]);

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
    task: "text-teal-500",
    action: "text-blue-500",
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
            placeholder="Search features, people, todos, pages..."
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
