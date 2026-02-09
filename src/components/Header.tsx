import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useSprint } from "@/hooks/useConfigRepo";
import { LogOut, ArrowLeftRight, Settings, ChevronDown } from "lucide-react";

export function Header() {
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
    <header className="bg-white border-b border-stone-200 px-4 sm:px-8 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold text-brand">{selectedOrg}</h1>
        {sprint && (
          <span className="text-sm text-stone-500">
            Sprint {sprint.number}: {sprint.name}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2" ref={menuRef}>
        {user && (
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-stone-50 transition-colors cursor-pointer"
          >
            <img
              src={user.avatar_url}
              alt={user.login}
              className="w-6 h-6 rounded-full"
            />
            <span className="text-sm text-stone-700 hidden sm:inline">
              {user.login}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
          </button>
        )}

        {menuOpen && (
          <div className="absolute right-4 sm:right-8 top-12 z-50 bg-white border border-stone-200 rounded-lg shadow-lg py-1 min-w-[180px]">
            <button
              onClick={() => { setSelectedOrg(null); setMenuOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50 cursor-pointer"
            >
              <ArrowLeftRight className="w-4 h-4" />
              Switch Organisation
            </button>
            <button
              onClick={() => { setMenuOpen(false); window.dispatchEvent(new CustomEvent("open-settings")); }}
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
    </header>
  );
}
