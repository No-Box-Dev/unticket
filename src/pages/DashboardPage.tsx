import { useState, useMemo, useCallback, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useRepos, useSyncStatus, useTriggerSync } from "@/hooks/useGitHub";
import { Header } from "@/components/Header";
import { TabBar } from "@/components/TabBar";
import { SprintTab } from "@/components/tabs/SprintTab";
import { BacklogTab } from "@/components/tabs/BacklogTab";
import { TeamTab } from "@/components/tabs/TeamTab";
import { IndividualTab } from "@/components/tabs/IndividualTab";
import { PRsTab } from "@/components/tabs/PRsTab";
import { IssuesTab } from "@/components/tabs/IssuesTab";
import { ActivityTab } from "@/components/tabs/ActivityTab";
import { TodoTab } from "@/components/tabs/TodoTab";
import { SettingsTab } from "@/components/tabs/SettingsTab";
import type { TabId } from "@/lib/types";

export function DashboardPage() {
  const { selectedOrg } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>("sprint");
  const [showSettings, setShowSettings] = useState(false);

  const { data: repos } = useRepos();
  const repoNames = useMemo(
    () => repos?.map((r) => r.name) ?? [],
    [repos],
  );

  // Auto-sync from GitHub when data is stale (disabled in dev to save rate limits)
  const { data: syncStatus } = useSyncStatus();
  const { mutate: sync, isPending: isSyncing } = useTriggerSync();
  useEffect(() => {
    if (import.meta.env.DEV) return;
    if (syncStatus?.isStale && !isSyncing) {
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
      {import.meta.env.DEV && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-2">
          <button
            onClick={() => sync()}
            disabled={isSyncing}
            className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded hover:bg-amber-200 disabled:opacity-50 cursor-pointer"
          >
            {isSyncing ? "Syncing..." : "Sync now (dev)"}
          </button>
        </div>
      )}
      <TabBar activeTab={activeTab} onTabChange={handleTabChange} />
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
            {activeTab === "team" && <TeamTab repoNames={repoNames} />}
            {activeTab === "individual" && <IndividualTab repoNames={repoNames} />}
            {activeTab === "prs" && <PRsTab repoNames={repoNames} />}
            {activeTab === "issues" && <IssuesTab repoNames={repoNames} />}
            {activeTab === "activity" && <ActivityTab repoNames={repoNames} />}
            {activeTab === "todos" && <TodoTab />}
          </>
        )}
      </main>
    </div>
  );
}
