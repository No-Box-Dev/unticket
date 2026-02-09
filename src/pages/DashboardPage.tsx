import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useRepos } from "@/hooks/useGitHub";
import { Header } from "@/components/Header";
import { TabBar } from "@/components/TabBar";
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

  const { data: repos } = useRepos();
  const repoNames = useMemo(
    () => repos?.map((r) => r.name) ?? [],
    [repos],
  );

  // Listen for settings open event from Header dropdown
  useEffect(() => {
    const handler = () => setShowSettings(true);
    window.addEventListener("open-settings", handler);
    return () => window.removeEventListener("open-settings", handler);
  }, []);

  if (!selectedOrg) return null;

  if (showSettings) {
    return (
      <div className="min-h-screen bg-stone-50">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <button
            onClick={() => setShowSettings(false)}
            className="text-sm text-stone-500 hover:text-brand mb-4 cursor-pointer"
          >
            &larr; Back to dashboard
          </button>
          <SettingsTab />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <Header />
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === "sprint" && <SprintTab repoNames={repoNames} />}
        {activeTab === "backlog" && <BacklogTab />}
        {activeTab === "team" && <TeamTab repoNames={repoNames} />}
        {activeTab === "individual" && <IndividualTab repoNames={repoNames} />}
        {activeTab === "prs" && <PRsTab repoNames={repoNames} />}
        {activeTab === "issues" && <IssuesTab repoNames={repoNames} />}
        {activeTab === "activity" && <ActivityTab repoNames={repoNames} />}
      </main>
    </div>
  );
}
