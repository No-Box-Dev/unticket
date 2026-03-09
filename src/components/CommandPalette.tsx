import { useState, useEffect, useRef, useMemo } from "react";
import { Search } from "lucide-react";
import { useFeatures } from "@/hooks/useConfigRepo";
import { usePeople } from "@/hooks/useConfigRepo";
import { cn } from "@/lib/cn";
import type { TabId } from "@/lib/types";

interface CommandPaletteProps {
  onNavigate: (tab: TabId) => void;
}

interface SearchResult {
  type: "feature" | "person" | "tab";
  label: string;
  detail?: string;
  action: () => void;
}

const TAB_ITEMS: { id: TabId; label: string; keywords: string }[] = [
  { id: "sprint", label: "Sprint Board", keywords: "sprint kanban board features" },
  { id: "backlog", label: "Future Features", keywords: "backlog future" },
  { id: "prs", label: "Pull Requests", keywords: "prs pull requests" },
  { id: "issues", label: "Issues", keywords: "issues bugs" },
  { id: "todos", label: "Todos", keywords: "todos tasks" },
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
      // Show tabs when empty
      return TAB_ITEMS.map((t) => ({
        type: "tab" as const,
        label: t.label,
        action: () => { onNavigate(t.id); setOpen(false); },
      }));
    }

    const items: SearchResult[] = [];

    // Search features
    for (const f of features ?? []) {
      if (f.title.toLowerCase().includes(q) || f.owners.some((o) => o.toLowerCase().includes(q))) {
        items.push({
          type: "feature",
          label: f.title,
          detail: f.sprint ? `Sprint ${f.sprint}` : "Backlog",
          action: () => {
            onNavigate(f.status === "future" ? "backlog" : "sprint");
            setOpen(false);
          },
        });
      }
      if (items.length >= 20) break;
    }

    // Search people
    for (const p of people ?? []) {
      if (p.name.toLowerCase().includes(q) || p.github.toLowerCase().includes(q)) {
        items.push({
          type: "person",
          label: p.name || p.github,
          detail: p.role || p.teams.join(", "),
          action: () => { onNavigate("sprint"); setOpen(false); },
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

    return items.slice(0, 20);
  }, [query, features, people, onNavigate]);

  // Keyboard navigation
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

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

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-white rounded-xl shadow-xl border border-stone-200 overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-200">
          <Search size={16} className="text-stone-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search features, people, pages..."
            className="flex-1 text-sm text-stone-800 placeholder:text-stone-400 outline-none bg-transparent"
          />
          <kbd className="hidden sm:inline-flex px-1.5 py-0.5 text-xs text-stone-400 bg-stone-100 rounded border border-stone-200 font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-6 text-sm text-stone-400 text-center">No results</div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.type}-${r.label}-${i}`}
              onClick={r.action}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2.5 text-left cursor-pointer transition-colors",
                i === selectedIndex ? "bg-stone-100" : "hover:bg-stone-50",
              )}
            >
              <span className={cn(
                "text-xs uppercase tracking-wider font-medium w-14 shrink-0",
                r.type === "feature" ? "text-brand" : r.type === "person" ? "text-amber-500" : "text-stone-400",
              )}>
                {r.type}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-sm text-stone-800 truncate block">{r.label}</span>
                {r.detail && <span className="text-xs text-stone-400">{r.detail}</span>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
