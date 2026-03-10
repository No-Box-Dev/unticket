import { useState, useRef, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useIsAdmin } from "@/hooks/useGitHub";
import { LogOut, ArrowLeftRight, Shield, Moon, Sun } from "lucide-react";
import { LogoMark } from "./LogoMark";
import { cn } from "@/lib/cn";
import { useTheme } from "@/lib/theme";
import type { TabId } from "@/lib/types";

const baseTabs: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "sprint", label: "Sprint" },
  { id: "backlog", label: "Future Features" },
  { id: "prs", label: "PRs" },
  { id: "issues", label: "Issues" },
  { id: "todos", label: "Todos" },
  { id: "engineers", label: "Engineers" },
];

interface HeaderProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onOpenSettings: () => void;
}

export function Header({ activeTab, onTabChange, onOpenSettings }: HeaderProps) {
  const { user, setSelectedOrg, logout } = useAuth();
  const isAdmin = useIsAdmin();
  const { dark, toggle: toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const tabs = useMemo(() => {
    const t: { id: TabId; label: string }[] = [...baseTabs];
    if (isAdmin) t.push({ id: "insights", label: "Insights" });
    return t;
  }, [isAdmin]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <header className="bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-700">
      <div className="px-4 sm:px-8 flex items-center justify-between h-14">
        {/* Logo + Tabs */}
        <div className="flex items-center gap-6 h-full">
          <div className="flex items-center gap-2.5 shrink-0">
            <LogoMark className="w-7 h-7" />
            <h1 className="text-lg font-bold text-stone-900 dark:text-stone-100 font-display">Unticket</h1>
          </div>

          <nav className="flex items-center gap-1 h-full overflow-x-auto">
            {tabs.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => onTabChange(id)}
                className={cn(
                  "px-3 py-1.5 text-sm transition-colors whitespace-nowrap cursor-pointer rounded-lg",
                  activeTab === id
                    ? "bg-brand/10 text-brand font-medium"
                    : "text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800",
                )}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Right: theme + user + admin */}
        <div className="flex items-center gap-1.5 shrink-0" ref={menuRef}>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {user && (
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors cursor-pointer"
            >
              <span className="text-sm text-stone-700 dark:text-stone-300">
                {user.name ?? user.login}
                {isAdmin && <span className="ml-1 text-xs text-brand/70">(admin)</span>}
              </span>
            </button>
          )}

          {isAdmin && (
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand/30 bg-brand/5 hover:bg-brand/10 transition-colors cursor-pointer text-brand text-sm font-medium"
              title="Settings"
            >
              <Shield className="w-3.5 h-3.5" />
              Admin
            </button>
          )}

          {menuOpen && (
            <div className="absolute right-4 sm:right-8 top-14 z-50 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg shadow-md py-1 min-w-[180px]">
              <button
                onClick={() => { setSelectedOrg(null); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700 cursor-pointer"
              >
                <ArrowLeftRight className="w-4 h-4" />
                Switch Organisation
              </button>
              <div className="border-t border-stone-100 dark:border-stone-700 my-1" />
              <button
                onClick={() => { logout(); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-stone-50 dark:hover:bg-stone-700 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
