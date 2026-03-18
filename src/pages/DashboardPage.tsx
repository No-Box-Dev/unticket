import { useState, useMemo, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useRepos } from "@/hooks/useGitHub";
import { useSidebar } from "@/lib/sidebar";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { OverviewTab } from "@/components/tabs/OverviewTab";
import { SprintTab } from "@/components/tabs/SprintTab";
import { BacklogTab } from "@/components/tabs/BacklogTab";
import { PRsTab } from "@/components/tabs/PRsTab";
import { IssuesTab } from "@/components/tabs/IssuesTab";
import { TodoTab } from "@/components/tabs/TodoTab";
import { EngineersTab } from "@/components/tabs/EngineersTab";
import { WorkloadTab } from "@/components/tabs/WorkloadTab";
import { SettingsTab } from "@/components/tabs/SettingsTab";
import { CommandPalette } from "@/components/CommandPalette";
import { cn } from "@/lib/cn";
import type { TabId, NavFilter } from "@/lib/types";

export function DashboardPage() {
  const { selectedOrg } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [navFilter, setNavFilter] = useState<NavFilter | null>(null);
  const { collapsed } = useSidebar();
  const { data: repos } = useRepos();
  const repoNames = useMemo(
    () => repos?.map((r) => r.name) ?? [],
    [repos],
  );

  const handleTabChange = useCallback((tab: TabId, filter?: NavFilter) => {
    setActiveTab(tab);
    setNavFilter(filter ?? null);
  }, []);

  if (!selectedOrg) return null;

  return (
    <div className="flex min-h-screen bg-stone-50 dark:bg-dark-base">
      <CommandPalette onNavigate={handleTabChange} />
      <Sidebar activeTab={activeTab} onTabChange={handleTabChange} />

      {/* Main content area — offset by sidebar width */}
      <div
        className={cn(
          "flex-1 flex flex-col min-w-0 transition-[margin] duration-200",
          "lg:ml-56",
          collapsed && "lg:ml-14",
        )}
      >
        <TopBar activeTab={activeTab} />

        <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
          {activeTab === "settings" && <SettingsTab />}
          {activeTab === "overview" && <OverviewTab repoNames={repoNames} onTabChange={handleTabChange} />}
          {activeTab === "sprint" && <SprintTab repoNames={repoNames} navFilter={navFilter} />}
          {activeTab === "backlog" && <BacklogTab />}
          {activeTab === "prs" && <PRsTab repoNames={repoNames} navFilter={navFilter} />}
          {activeTab === "issues" && <IssuesTab repoNames={repoNames} navFilter={navFilter} />}
          {activeTab === "todos" && <TodoTab />}
          {activeTab === "engineers" && <EngineersTab repoNames={repoNames} navFilter={navFilter} />}
          {activeTab === "workload" && <WorkloadTab repoNames={repoNames} />}
        </main>
      </div>
    </div>
  );
}
