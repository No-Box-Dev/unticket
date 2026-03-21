import { useRateLimit } from "@/hooks/useGitHub";
import { useSidebar } from "@/lib/sidebar";
import { Menu, Search, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { TabId } from "@/lib/types";

const TAB_LABELS: Partial<Record<TabId, string>> = {
  overview: "Overview",
  sprint: "Sprint Board",
  backlog: "Backlog",
  prs: "Pull Requests",
  issues: "Issues",
  todos: "My Todos",
  engineers: "Engineers",
  workload: "Workload",
  settings: "Settings",
};

interface TopBarProps {
  activeTab: TabId;
}

export function TopBar({ activeTab }: TopBarProps) {
  const { collapsed, toggleCollapsed, setMobileOpen } = useSidebar();
  const { data: rateLimit } = useRateLimit();
  const isRateLimited = rateLimit && rateLimit.remaining < rateLimit.limit * 0.2;

  return (
    <header className="h-12 shrink-0 bg-white dark:bg-dark-raised border-b border-stone-200 dark:border-white/[0.06] flex items-center justify-between px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setMobileOpen(true)}
          className="lg:hidden p-1.5 rounded-lg text-stone-500 dark:text-neutral-400 hover:bg-stone-100 dark:hover:bg-white/[0.06] cursor-pointer"
        >
          <Menu className="w-5 h-5" />
        </button>
        <h2 className="text-sm font-semibold text-stone-800 dark:text-neutral-200">
          {TAB_LABELS[activeTab] ?? "Dashboard"}
        </h2>
      </div>

      <div className="flex items-center gap-2">
        {/* CMD+K trigger */}
        <button
          onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-white/[0.06] text-stone-400 dark:text-neutral-500 hover:bg-stone-50 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="text-xs hidden sm:inline">Search</span>
          <kbd className="hidden sm:inline-flex text-[10px] px-1 py-0.5 rounded bg-stone-100 dark:bg-dark-overlay border border-stone-200 dark:border-white/[0.06] font-mono">
            {"\u2318"}K
          </kbd>
        </button>

        {/* Rate limit indicator */}
        {isRateLimited && (
          <div
            className="w-2 h-2 rounded-full bg-amber-400 shrink-0"
            title={`GitHub API: ${rateLimit.remaining}/${rateLimit.limit} remaining`}
          />
        )}

        {/* Sidebar collapse toggle — desktop only */}
        <button
          onClick={toggleCollapsed}
          className="hidden lg:flex p-1.5 rounded-lg text-stone-400 dark:text-neutral-500 hover:bg-stone-100 dark:hover:bg-white/[0.06] hover:text-stone-600 dark:hover:text-neutral-300 transition-colors cursor-pointer"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
}
