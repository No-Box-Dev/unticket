import { useState, useMemo, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useRepos } from "@/hooks/useGitHub";
import { Sidebar } from "@/components/Sidebar";
import { SprintTab } from "@/components/tabs/SprintTab";
import { BacklogTab } from "@/components/tabs/BacklogTab";
import { TeamTab } from "@/components/tabs/TeamTab";
import { IndividualTab } from "@/components/tabs/IndividualTab";
import { PRsTab } from "@/components/tabs/PRsTab";
import { IssuesTab } from "@/components/tabs/IssuesTab";
import { ActivityTab } from "@/components/tabs/ActivityTab";
import { SettingsTab } from "@/components/tabs/SettingsTab";
import type { TabId } from "@/lib/types";

export function DashboardPage() {
  const { selectedOrg } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>("sprint");
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const { data: repos } = useRepos();
  const repoNames = useMemo(
    () => repos?.map((r) => r.name) ?? [],
    [repos],
  );

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
    setShowSettings(false);
  }, []);

  if (!selectedOrg) return null;

  return (
    <div className="min-h-screen bg-stone-50">
      <Sidebar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onOpenSettings={() => setShowSettings(true)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <main
        className="transition-all duration-200"
        style={{ marginLeft: sidebarCollapsed ? 64 : 240 }}
      >
        <div className="max-w-7xl mx-auto px-6 lg:px-8 py-6">
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
            </>
          )}
        </div>
      </main>
    </div>
  );
}
