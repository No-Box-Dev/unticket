import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useIsAdmin } from "@/hooks/useGitHub";
import { useSprint } from "@/hooks/useConfigRepo";
import { useSidebar } from "@/lib/sidebar";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/cn";
import { LogoMark } from "./LogoMark";
import {
  LayoutDashboard,
  Rocket,
  Layers,
  GitPullRequest,
  CircleDot,
  CheckSquare,
  Users,
  BarChart3,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  ArrowLeftRight,
  ChevronDown,
  Moon,
  Sun,
  X,
} from "lucide-react";
import type { TabId } from "@/lib/types";

interface NavGroup {
  label: string;
  items: { id: TabId; label: string; icon: typeof Rocket; adminOnly?: boolean }[];
}

const navGroups: NavGroup[] = [
  {
    label: "Planning",
    items: [
      { id: "overview", label: "Overview", icon: LayoutDashboard },
      { id: "sprint", label: "Sprint Board", icon: Rocket },
      { id: "backlog", label: "Backlog", icon: Layers },
    ],
  },
  {
    label: "Tracking",
    items: [
      { id: "prs", label: "Pull Requests", icon: GitPullRequest },
      { id: "issues", label: "Issues", icon: CircleDot },
    ],
  },
  {
    label: "Personal",
    items: [
      { id: "todos", label: "My Todos", icon: CheckSquare },
      { id: "engineers", label: "Engineers", icon: Users },
    ],
  },
  {
    label: "Analytics",
    items: [
      { id: "insights", label: "Insights", icon: BarChart3, adminOnly: true },
    ],
  },
];

interface SidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const { user, setSelectedOrg, logout } = useAuth();
  const { data: sprint } = useSprint();
  const isAdmin = useIsAdmin();
  const { dark, toggle: toggleTheme } = useTheme();
  const { collapsed, mobileOpen, toggleCollapsed, setMobileOpen, viewingSprint, setViewingSprint } = useSidebar();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close user menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Keyboard shortcut: [ to toggle sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "[" && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        toggleCollapsed();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [toggleCollapsed]);

  const handleNav = (tab: TabId) => {
    onTabChange(tab);
    setMobileOpen(false);
  };

  const sidebarContent = (
    <>
      {/* Header */}
      <div className="px-3 py-3 border-b border-stone-100 dark:border-white/[0.06] flex items-center justify-between">
        {collapsed && !mobileOpen ? (
          <button
            onClick={toggleCollapsed}
            className="mx-auto p-1 rounded-lg text-stone-400 dark:text-neutral-500 hover:bg-stone-100 dark:hover:bg-white/[0.06] hover:text-stone-600 dark:hover:text-neutral-300 cursor-pointer"
            title="Expand sidebar"
          >
            <PanelLeftOpen className="w-5 h-5" />
          </button>
        ) : (
          <>
            <div className="flex items-center gap-2.5 min-w-0">
              <LogoMark className="w-7 h-7 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-base font-bold text-stone-900 dark:text-neutral-100 font-display truncate">Unticket</h1>
                {sprint && (
                  <p className="text-[11px] text-stone-400 dark:text-neutral-500 truncate">
                    Sprint {sprint.number}
                  </p>
                )}
              </div>
            </div>
            {!mobileOpen && (
              <button
                onClick={toggleCollapsed}
                className="hidden lg:flex p-1 rounded-lg text-stone-400 dark:text-neutral-500 hover:bg-stone-100 dark:hover:bg-white/[0.06] hover:text-stone-600 dark:hover:text-neutral-300 cursor-pointer shrink-0"
                title="Collapse sidebar"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 py-3 px-2 overflow-y-auto space-y-4">
        {navGroups.map((group) => {
          const visibleItems = group.items.filter((item) => !item.adminOnly || isAdmin);
          if (visibleItems.length === 0) return null;

          const expanded = !collapsed || mobileOpen;

          return (
            <div key={group.label}>
              {expanded && (
                <div className="px-3 mb-1 text-[10px] uppercase tracking-wider font-medium text-stone-400 dark:text-neutral-500">
                  {group.label}
                </div>
              )}
              <div className="space-y-0.5">
                {visibleItems.map(({ id, label, icon: Icon }) => {
                  const isActive = activeTab === id;
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        if (id === "sprint") setViewingSprint(null);
                        handleNav(id);
                      }}
                      title={!expanded ? label : undefined}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-lg text-sm font-medium transition-colors cursor-pointer relative",
                        !expanded ? "justify-center px-2 py-2.5" : "px-3 py-2",
                        isActive
                          ? "bg-brand/10 text-brand"
                          : "text-stone-500 dark:text-neutral-400 hover:bg-stone-50 dark:hover:bg-white/[0.06] hover:text-stone-700 dark:hover:text-neutral-200",
                      )}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-brand rounded-r" />
                      )}
                      <Icon className="w-[18px] h-[18px] shrink-0" />
                      {expanded && <span className="truncate">{label}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Bottom Section */}
      <div className="border-t border-stone-100 dark:border-white/[0.06] px-2 py-2 space-y-0.5">
        {/* Settings */}
        <button
          onClick={() => handleNav("settings")}
          title={collapsed && !mobileOpen ? "Settings" : undefined}
          className={cn(
            "w-full flex items-center gap-3 rounded-lg text-sm font-medium transition-colors cursor-pointer",
            collapsed && !mobileOpen ? "justify-center px-2 py-2.5" : "px-3 py-2",
            activeTab === "settings"
              ? "bg-brand/10 text-brand"
              : "text-stone-500 dark:text-neutral-400 hover:bg-stone-50 dark:hover:bg-white/[0.06] hover:text-stone-700 dark:hover:text-neutral-200",
          )}
        >
          <Settings className="w-[18px] h-[18px] shrink-0" />
          {(!collapsed || mobileOpen) && <span className="truncate">Settings</span>}
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={collapsed && !mobileOpen ? (dark ? "Light mode" : "Dark mode") : undefined}
          className={cn(
            "w-full flex items-center gap-3 rounded-lg text-sm font-medium transition-colors cursor-pointer",
            collapsed && !mobileOpen ? "justify-center px-2 py-2.5" : "px-3 py-2",
            "text-stone-500 dark:text-neutral-400 hover:bg-stone-50 dark:hover:bg-white/[0.06] hover:text-stone-700 dark:hover:text-neutral-200",
          )}
        >
          {dark ? <Sun className="w-[18px] h-[18px] shrink-0" /> : <Moon className="w-[18px] h-[18px] shrink-0" />}
          {(!collapsed || mobileOpen) && <span className="truncate">{dark ? "Light Mode" : "Dark Mode"}</span>}
        </button>

      </div>

      {/* User menu */}
      <div className="border-t border-stone-100 dark:border-white/[0.06] px-2 py-2" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className={cn(
            "w-full flex items-center gap-2 rounded-lg hover:bg-stone-50 dark:hover:bg-white/[0.06] transition-colors cursor-pointer",
            collapsed && !mobileOpen ? "justify-center px-2 py-2" : "px-3 py-2",
          )}
        >
          {user && (
            <img src={user.avatar_url} alt={user.login} className="w-7 h-7 rounded-full shrink-0" />
          )}
          {(!collapsed || mobileOpen) && (
            <>
              <span className="text-sm text-stone-700 dark:text-neutral-300 truncate flex-1 text-left">
                {user?.name ?? user?.login}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-stone-400 dark:text-neutral-500 shrink-0" />
            </>
          )}
        </button>

        {menuOpen && (
          <div
            className={cn(
              "absolute bottom-16 bg-white dark:bg-dark-overlay border border-stone-200 dark:border-white/[0.06] rounded-lg shadow-md py-1 min-w-[180px] z-50",
              collapsed && !mobileOpen ? "left-16 ml-1" : "left-2 right-2",
            )}
          >
            <button
              onClick={() => { setSelectedOrg(null); setMenuOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-stone-600 dark:text-neutral-300 hover:bg-stone-50 dark:hover:bg-white/[0.1] cursor-pointer"
            >
              <ArrowLeftRight className="w-4 h-4" />
              Switch Organisation
            </button>
            <div className="border-t border-stone-100 dark:border-white/[0.06] my-1" />
            <button
              onClick={() => { logout(); setMenuOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-stone-50 dark:hover:bg-white/[0.1] cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex fixed left-0 top-0 h-screen bg-white dark:bg-dark-raised border-r border-stone-200 dark:border-white/[0.06] flex-col z-40 transition-[width] duration-200 overflow-hidden",
          collapsed ? "w-14" : "w-56",
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-56 h-full bg-white dark:bg-dark-raised border-r border-stone-200 dark:border-white/[0.06] flex flex-col">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-3 right-3 p-1 rounded-lg text-stone-400 dark:text-neutral-500 hover:bg-stone-100 dark:hover:bg-white/[0.06] cursor-pointer z-10"
            >
              <X className="w-4 h-4" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
