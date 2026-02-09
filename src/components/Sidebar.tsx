import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useSprint } from "@/hooks/useConfigRepo";
import { cn } from "@/lib/cn";
import {
  Rocket,
  Layers,
  Users,
  User,
  GitPullRequest,
  CircleDot,
  BarChart3,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  ArrowLeftRight,
  Settings,
  ChevronDown,
} from "lucide-react";
import type { TabId } from "@/lib/types";

const navItems: { id: TabId; label: string; icon: typeof Rocket }[] = [
  { id: "sprint", label: "Sprint", icon: Rocket },
  { id: "backlog", label: "Future Features", icon: Layers },
  { id: "team", label: "Team Dashboard", icon: Users },
  { id: "individual", label: "Individual", icon: User },
  { id: "prs", label: "Open PRs", icon: GitPullRequest },
  { id: "issues", label: "Open Issues", icon: CircleDot },
  { id: "activity", label: "Activity", icon: BarChart3 },
];

interface SidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onOpenSettings: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ activeTab, onTabChange, onOpenSettings, collapsed, onToggleCollapse }: SidebarProps) {
  const { user, selectedOrg, setSelectedOrg, logout } = useAuth();
  const { data: sprint } = useSprint();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 h-screen bg-white border-r border-stone-200 flex flex-col z-40 transition-all duration-200",
        collapsed ? "w-16" : "w-60",
      )}
    >
      {/* Org header */}
      <div className="px-3 py-4 border-b border-stone-100">
        {collapsed ? (
          <div className="w-10 h-10 rounded-lg bg-brand/10 flex items-center justify-center text-brand font-bold text-sm">
            {(selectedOrg ?? "?")[0].toUpperCase()}
          </div>
        ) : (
          <div>
            <h1 className="text-base font-bold text-brand truncate">{selectedOrg}</h1>
            {sprint && (
              <p className="text-[11px] text-stone-400 mt-0.5 truncate">
                Sprint {sprint.number}: {sprint.name}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            title={collapsed ? label : undefined}
            className={cn(
              "w-full flex items-center gap-3 rounded-lg text-sm font-medium transition-colors cursor-pointer",
              collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5",
              activeTab === id
                ? "bg-brand/10 text-brand"
                : "text-stone-500 hover:bg-stone-50 hover:text-stone-700",
            )}
          >
            <Icon className="w-[18px] h-[18px] flex-shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </button>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="px-2 py-1 border-t border-stone-100">
        <button
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-stone-400 hover:text-stone-600 rounded-lg hover:bg-stone-50 transition-colors cursor-pointer"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen className="w-4 h-4" />
          ) : (
            <>
              <PanelLeftClose className="w-4 h-4" />
              <span className="text-xs">Collapse</span>
            </>
          )}
        </button>
      </div>

      {/* User menu */}
      <div className="px-2 py-3 border-t border-stone-100" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className={cn(
            "w-full flex items-center gap-2 rounded-lg hover:bg-stone-50 transition-colors cursor-pointer",
            collapsed ? "justify-center px-2 py-2" : "px-3 py-2",
          )}
        >
          {user && (
            <img
              src={user.avatar_url}
              alt={user.login}
              className="w-7 h-7 rounded-full flex-shrink-0"
            />
          )}
          {!collapsed && (
            <>
              <span className="text-sm text-stone-700 truncate flex-1 text-left">
                {user?.login}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
            </>
          )}
        </button>

        {menuOpen && (
          <div
            className={cn(
              "absolute bottom-16 bg-white border border-stone-200 rounded-lg shadow-lg py-1 min-w-[180px]",
              collapsed ? "left-16 ml-1" : "left-2 right-2",
            )}
          >
            <button
              onClick={() => { setSelectedOrg(null); setMenuOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50 cursor-pointer"
            >
              <ArrowLeftRight className="w-4 h-4" />
              Switch Organisation
            </button>
            <button
              onClick={() => { onOpenSettings(); setMenuOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50 cursor-pointer"
            >
              <Settings className="w-4 h-4" />
              Settings
            </button>
            <div className="border-t border-stone-100 my-1" />
            <button
              onClick={() => { logout(); setMenuOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-stone-50 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
