import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useRateLimit, useTriggerFeatureSync } from "@/hooks/useGitHub";
import { cn } from "@/lib/cn";
import { Search, Settings, ChevronDown, ArrowLeftRight, LogOut, Sparkles, Loader2 } from "lucide-react";
import type { TabId } from "@/lib/types";
import { SyncFromGithubMenuItem, SyncFromGithubModal } from "@/components/SyncFromGithub";

const NAV_ITEMS: { id: TabId; label: string }[] = [
  { id: "engineers", label: "People" },
  { id: "sprint", label: "Features" },
  { id: "posts", label: "Feed" },
  { id: "prs", label: "PR" },
  { id: "issues", label: "Issues" },
  { id: "repos", label: "Repos" },
];

interface TopNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function TopNav({ activeTab, onTabChange }: TopNavProps) {
  const { user, setSelectedOrg, logout } = useAuth();
  const { data: rateLimit } = useRateLimit();
  const syncFeaturesMut = useTriggerFeatureSync();
  const isRateLimited = rateLimit && rateLimit.remaining < rateLimit.limit * 0.2;
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleNav = (id: TabId) => {
    onTabChange(id);
  };

  return (
    <header className="shrink-0 bg-white border-b border-stone-200 sticky top-0 z-30">
      <div className="h-14 px-4 sm:px-6 flex items-center justify-between gap-4">
        {/* Logo */}
        <button
          onClick={() => handleNav("issues")}
          className="text-base font-display text-stone-800 cursor-pointer shrink-0 tracking-tight"
        >
          <span className="font-bold">un</span>
          <span className="font-normal">ticket</span>
        </button>

        {/* Centered nav */}
        <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {NAV_ITEMS.map(({ id, label }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => handleNav(id)}
                className={cn(
                  "relative px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
                  isActive ? "text-stone-900" : "text-stone-500 hover:text-stone-800",
                )}
              >
                {label}
                {isActive && (
                  <span className="absolute left-3 right-3 -bottom-[1px] h-[2px] bg-accent rounded-full" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Right cluster */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-stone-200 text-stone-400 hover:bg-stone-50 transition-colors cursor-pointer"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="text-xs hidden sm:inline">Search</span>
            <kbd className="hidden sm:inline-flex text-[10px] px-1 py-0.5 rounded bg-stone-100 border border-stone-200 font-mono">{"⌘"}K</kbd>
          </button>

          {isRateLimited && (
            <div
              className="w-2 h-2 rounded-full bg-severity-mid shrink-0"
              title={`GitHub API: ${rateLimit.remaining}/${rateLimit.limit} remaining`}
            />
          )}

          <button
            onClick={() => onTabChange("settings")}
            className={cn(
              "p-1.5 rounded-lg transition-colors cursor-pointer",
              activeTab === "settings"
                ? "bg-accent/10 text-accent"
                : "text-stone-400 hover:bg-stone-100 hover:text-stone-600",
            )}
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-1.5 pl-1 pr-1.5 py-1 rounded-lg hover:bg-stone-50 transition-colors cursor-pointer"
            >
              {user && (
                <img src={user.avatar_url} alt={user.login} className="w-7 h-7 rounded-full shrink-0" />
              )}
              <ChevronDown className="w-3 h-3 text-stone-400 shrink-0" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-stone-200 rounded-lg shadow-md py-1 min-w-[200px] z-50">
                <div className="px-3 py-2 border-b border-stone-100">
                  <div className="text-sm text-stone-700 truncate">{user?.name ?? user?.login}</div>
                  {user?.name && (
                    <div className="text-xs text-stone-400 truncate">@{user.login}</div>
                  )}
                </div>
                <button
                  onClick={() => { setSelectedOrg(null); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50 cursor-pointer"
                >
                  <ArrowLeftRight className="w-4 h-4" />
                  Switch Organisation
                </button>
                <button
                  onClick={() => {
                    if (syncFeaturesMut.isPending) return;
                    syncFeaturesMut.mutate(undefined, {
                      onSettled: () => setMenuOpen(false),
                    });
                  }}
                  disabled={syncFeaturesMut.isPending}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50 cursor-pointer disabled:opacity-60 disabled:cursor-wait"
                >
                  {syncFeaturesMut.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  {syncFeaturesMut.isPending ? "Syncing features…" : "Sync features"}
                </button>
                <SyncFromGithubMenuItem
                  onTrigger={() => {
                    setMenuOpen(false);
                    setSyncOpen(true);
                  }}
                />
                <div className="border-t border-stone-100 my-1" />
                <button
                  onClick={() => { logout(); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-stone-500 hover:text-severity-high hover:bg-stone-50 cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile nav row */}
      <nav className="md:hidden flex items-center gap-1 px-2 pb-1.5 overflow-x-auto">
        {NAV_ITEMS.map(({ id, label }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => handleNav(id)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer",
                isActive ? "bg-accent/10 text-accent" : "text-stone-500 hover:bg-stone-50",
              )}
            >
              {label}
            </button>
          );
        })}
      </nav>

      <SyncFromGithubModal open={syncOpen} onClose={() => setSyncOpen(false)} />
    </header>
  );
}
