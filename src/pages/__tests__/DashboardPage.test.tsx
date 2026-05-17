import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/auth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useGitHub", () => ({ useRepos: vi.fn() }));
vi.mock("@/hooks/useConfigRepo", () => ({ useSettings: vi.fn() }));
vi.mock("@/lib/unticket-repo-name", () => ({ setUnticketRepoName: vi.fn() }));

// Stub out heavy children so we only test the routing skeleton.
vi.mock("@/components/TopNav", () => ({
  TopNav: ({ activeTab }: { activeTab: string }) => (
    <div data-testid="topnav">active:{activeTab}</div>
  ),
}));
vi.mock("@/components/CommandPalette", () => ({
  CommandPalette: () => <div data-testid="cmdk" />,
}));
vi.mock("@/components/BootstrapOverlay", () => ({
  BootstrapOverlay: () => <div data-testid="bootstrap" />,
}));
vi.mock("@/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Each lazy-tab import resolves to a tiny named component.
vi.mock("@/components/tabs/SprintTab", () => ({
  SprintTab: () => <div data-testid="tab-sprint" />,
}));
vi.mock("@/components/tabs/PRsTab", () => ({
  PRsTab: () => <div data-testid="tab-prs" />,
}));
vi.mock("@/components/tabs/IssuesTab", () => ({
  IssuesTab: () => <div data-testid="tab-issues" />,
}));
vi.mock("@/components/tabs/PostsTab", () => ({
  PostsTab: () => <div data-testid="tab-posts" />,
}));
vi.mock("@/components/tabs/ReposTab", () => ({
  ReposTab: () => <div data-testid="tab-repos" />,
}));
vi.mock("@/components/tabs/EngineersTab", () => ({
  EngineersTab: () => <div data-testid="tab-engineers" />,
}));
vi.mock("@/components/tabs/SettingsTab", () => ({
  SettingsTab: () => <div data-testid="tab-settings" />,
}));

import { DashboardPage } from "../DashboardPage";
import { useAuth } from "@/lib/auth";
import { useRepos } from "@/hooks/useGitHub";
import { useSettings } from "@/hooks/useConfigRepo";

const mAuth = useAuth as unknown as ReturnType<typeof vi.fn>;
const mRepos = useRepos as unknown as ReturnType<typeof vi.fn>;
const mSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mAuth.mockReset();
  mRepos.mockReturnValue({ data: [{ name: "api" }] });
  mSettings.mockReturnValue({ data: { unticketRepo: "unticket" } });
});

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe("DashboardPage", () => {
  it("returns null when there is no selected org", () => {
    mAuth.mockReturnValue({ selectedOrg: null });
    const { container } = renderAt("/");
    expect(container.firstChild).toBeNull();
  });

  it("defaults to the issues tab when no tab param is set", async () => {
    mAuth.mockReturnValue({ selectedOrg: "acme" });
    renderAt("/");
    await waitFor(() => expect(screen.getByTestId("tab-issues")).toBeInTheDocument());
    expect(screen.getByTestId("topnav").textContent).toContain("active:issues");
  });

  it("renders the sprint tab when tab=sprint", async () => {
    mAuth.mockReturnValue({ selectedOrg: "acme" });
    renderAt("/?tab=sprint");
    await waitFor(() => expect(screen.getByTestId("tab-sprint")).toBeInTheDocument());
  });

  it("renders the settings tab when tab=settings", async () => {
    mAuth.mockReturnValue({ selectedOrg: "acme" });
    renderAt("/?tab=settings");
    await waitFor(() => expect(screen.getByTestId("tab-settings")).toBeInTheDocument());
  });

  it("falls back to issues for an unknown tab value", async () => {
    mAuth.mockReturnValue({ selectedOrg: "acme" });
    renderAt("/?tab=nonsense");
    await waitFor(() => expect(screen.getByTestId("tab-issues")).toBeInTheDocument());
  });
});
