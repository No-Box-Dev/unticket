import { useState, useMemo, useCallback, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useRepos, useSyncStatus, useTriggerSync, useIsAdmin } from "@/hooks/useGitHub";
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

interface ErrorToast {
  id: number;
  message: string;
  status?: number;
}

let errorId = 0;

export function DashboardPage() {
  const { selectedOrg } = useAuth();
  const isAdmin = useIsAdmin();
  const [activeTab, setActiveTab] = useState<TabId>("sprint");
  const [showSettings, setShowSettings] = useState(false);
  const [errors, setErrors] = useState<ErrorToast[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { message, status } = (e as CustomEvent).detail;
      const id = ++errorId;
      setErrors((prev) => [...prev.slice(-4), { id, message, status }]);
      setTimeout(() => setErrors((prev) => prev.filter((err) => err.id !== id)), 8000);
    };
    window.addEventListener("gp:error", handler);
    return () => window.removeEventListener("gp:error", handler);
  }, []);

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
      {errors.length > 0 && (
        <div className="fixed top-0 left-0 right-0 z-50 flex flex-col items-center gap-1 pt-2 pointer-events-none">
          {errors.map((err) => (
            <div
              key={err.id}
              className="pointer-events-auto px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-mono shadow-lg max-w-2xl truncate cursor-pointer"
              onClick={() => setErrors((prev) => prev.filter((e) => e.id !== err.id))}
            >
              {err.status && <span className="font-bold mr-2">{err.status}</span>}
              {err.message}
            </div>
          ))}
        </div>
      )}
      <Header onOpenSettings={() => setShowSettings(true)} />
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
