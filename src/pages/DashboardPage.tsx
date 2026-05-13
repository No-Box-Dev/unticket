import { useMemo, useCallback, useEffect, lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useRepos } from "@/hooks/useGitHub";
import { useSettings } from "@/hooks/useConfigRepo";
import { setUnticketRepoName } from "@/lib/unticket-repo-name";
import { TopNav } from "@/components/TopNav";
import { Spinner } from "@/components/Spinner";
import { CommandPalette } from "@/components/CommandPalette";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BootstrapOverlay } from "@/components/BootstrapOverlay";
import type { TabId, NavFilter } from "@/lib/types";

const SprintTab = lazy(() => import("@/components/tabs/SprintTab").then(m => ({ default: m.SprintTab })));
const PRsTab = lazy(() => import("@/components/tabs/PRsTab").then(m => ({ default: m.PRsTab })));
const IssuesTab = lazy(() => import("@/components/tabs/IssuesTab").then(m => ({ default: m.IssuesTab })));
const PostsTab = lazy(() => import("@/components/tabs/PostsTab").then(m => ({ default: m.PostsTab })));
const ReposTab = lazy(() => import("@/components/tabs/ReposTab").then(m => ({ default: m.ReposTab })));
const EngineersTab = lazy(() => import("@/components/tabs/EngineersTab").then(m => ({ default: m.EngineersTab })));
const SettingsTab = lazy(() => import("@/components/tabs/SettingsTab").then(m => ({ default: m.SettingsTab })));

const VALID_TABS = new Set<string>(["sprint", "prs", "issues", "posts", "repos", "engineers", "settings"]);

export function DashboardPage() {
  const { selectedOrg } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: repos } = useRepos();
  const { data: settings } = useSettings();
  useEffect(() => {
    setUnticketRepoName(settings?.unticketRepo);
  }, [settings?.unticketRepo]);
  const repoNames = useMemo(
    () => repos?.map((r) => r.name) ?? [],
    [repos],
  );

  const tabParam = searchParams.get("tab");
  const activeTab: TabId = tabParam && VALID_TABS.has(tabParam) ? tabParam as TabId : "issues";
  const rawF = searchParams.get("f");
  const featureId = rawF ? (Number.isFinite(Number(rawF)) ? Number(rawF) : undefined) : undefined;
  const personParam = searchParams.get("person") ?? undefined;
  const viewParam = searchParams.get("view") ?? undefined;

  const navFilter: NavFilter | null = personParam || viewParam ? { person: personParam, view: viewParam } : null;

  const handleTabChange = useCallback((tab: TabId, filter?: NavFilter) => {
    const params: Record<string, string> = {};
    if (tab !== "issues") params.tab = tab;
    if (filter?.person) params.person = filter.person;
    if (filter?.view) params.view = filter.view;
    setSearchParams(params, { replace: true });
  }, [setSearchParams]);

  if (!selectedOrg) return null;

  return (
    <div className="flex flex-col min-h-screen bg-stone-50">
      <BootstrapOverlay />
      <CommandPalette onNavigate={handleTabChange} />
      <TopNav activeTab={activeTab} onTabChange={handleTabChange} />

      <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <Suspense fallback={<div className="flex items-center justify-center py-20"><Spinner className="w-6 h-6 text-accent" /></div>}>
          <ErrorBoundary key={activeTab}>
            {activeTab === "settings" && <SettingsTab />}
            {activeTab === "sprint" && <SprintTab navFilter={navFilter} urlFeatureId={featureId} onUrlChange={(f) => {
              const params: Record<string, string> = { tab: "sprint" };
              if (f != null) params.f = String(f);
              if (personParam) params.person = personParam;
              if (viewParam) params.view = viewParam;
              setSearchParams(params, { replace: true });
            }} />}
            {activeTab === "prs" && <PRsTab repoNames={repoNames} navFilter={navFilter} />}
            {activeTab === "issues" && <IssuesTab repoNames={repoNames} navFilter={navFilter} />}
            {activeTab === "posts" && <PostsTab />}
            {activeTab === "repos" && <ReposTab repoNames={repoNames} />}
            {activeTab === "engineers" && <EngineersTab repoNames={repoNames} navFilter={navFilter} />}
          </ErrorBoundary>
        </Suspense>
      </main>
    </div>
  );
}
