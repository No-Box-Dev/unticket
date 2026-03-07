import { useState, useMemo, useCallback, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useRepos, useSyncStatus, useTriggerSync, useIsAdmin, useRateLimit } from "@/hooks/useGitHub";
import { Header } from "@/components/Header";
import { TabBar } from "@/components/TabBar";
import { SprintTab } from "@/components/tabs/SprintTab";
import { BacklogTab } from "@/components/tabs/BacklogTab";
import { PRsTab } from "@/components/tabs/PRsTab";
import { IssuesTab } from "@/components/tabs/IssuesTab";
import { TodoTab } from "@/components/tabs/TodoTab";
import { InsightsTab } from "@/components/tabs/InsightsTab";
import { SettingsTab } from "@/components/tabs/SettingsTab";
import type { TabId } from "@/lib/types";

export function DashboardPage() {
  const { selectedOrg } = useAuth();
  const isAdmin = useIsAdmin();
  const [activeTab, setActiveTab] = useState<TabId>("sprint");
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handler = (e: Event) => {
      const { message, status } = (e as CustomEvent).detail;
      setError({ message, status });
      clearTimeout(timer);
      timer = setTimeout(() => setError(null), 10000);
    };
    window.addEventListener("gp:error", handler);
    return () => { window.removeEventListener("gp:error", handler); clearTimeout(timer); };
  }, []);

  const { data: rateLimit } = useRateLimit();
  const { data: repos } = useRepos();
  const repoNames = useMemo(
    () => repos?.map((r) => r.name) ?? [],
    [repos],
  );

  // Auto-sync from GitHub when data is stale (skip if last attempt failed)
  const { data: syncStatus } = useSyncStatus();
  const { mutate: sync, isPending: isSyncing, isError: syncFailed } = useTriggerSync();
  useEffect(() => {
    if (syncStatus?.isStale && !isSyncing && !syncFailed) {
      sync();
    }
  }, [syncStatus?.isStale, isSyncing, sync]);

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
    setShowSettings(false);
  }, []);

  if (!selectedOrg) return null;

  return (
    <div className="min-h-screen bg-stone-50">
      <Header onOpenSettings={() => setShowSettings(true)} />
      {error && (
        <div
          className="bg-red-50 border-b border-red-200 px-4 sm:px-8 py-1.5 flex items-center justify-between cursor-pointer"
          onClick={() => setError(null)}
        >
          <span className="text-xs text-red-600 font-mono truncate">
            {error.status && <span className="font-semibold mr-1.5">{error.status}</span>}
            {error.message}
          </span>
          <span className="text-xs text-red-400 ml-2 shrink-0">dismiss</span>
        </div>
      )}
      {rateLimit && rateLimit.remaining < rateLimit.limit * 0.2 && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-8 py-1.5 flex items-center justify-between">
          <span className="text-xs text-amber-700">
            <span className="font-semibold">GitHub API:</span>{" "}
            {rateLimit.remaining}/{rateLimit.limit} requests remaining
            {" · "}resets {new Date(rateLimit.reset * 1000).toLocaleTimeString()}
          </span>
          {rateLimit.remaining === 0 && (
            <span className="text-xs text-amber-600 font-medium ml-2 shrink-0">Rate limited</span>
          )}
        </div>
      )}
      <TabBar activeTab={activeTab} onTabChange={handleTabChange} isAdmin={isAdmin} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {showSettings ? (
          <>
            <button
              onClick={() => setShowSettings(false)}
              className="text-sm text-stone-500 hover:text-brand mb-4 cursor-pointer"
            >
              &larr; Back to dashboard
            </button>
            <SettingsTab />
          </>
        ) : (
          <>
            {activeTab === "sprint" && <SprintTab repoNames={repoNames} />}
            {activeTab === "backlog" && <BacklogTab />}
            {activeTab === "prs" && <PRsTab repoNames={repoNames} />}
            {activeTab === "issues" && <IssuesTab repoNames={repoNames} />}
            {activeTab === "todos" && <TodoTab />}
            {activeTab === "insights" && <InsightsTab repoNames={repoNames} />}
          </>
        )}
      </main>
    </div>
  );
}
