import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useGitHub", () => ({
  useOpenPRs: vi.fn(),
  useMergedPRs: vi.fn(),
  useIsAdmin: vi.fn(() => false),
  useActiveMembers: vi.fn(() => ({ data: [] })),
  useEngineerStats: vi.fn(() => ({ data: undefined, isLoading: false })),
  useEngineerActivity: vi.fn(() => ({
    isLoading: false,
    data: {
      login: "alice",
      month: "2026-07",
      firstMonth: "2026-02",
      prsOpened: { "2026-07-03": 4 },
      prsReviewed: { "2026-07-03": 2 },
      monthlyOpened: { "2026-06": 3, "2026-07": 4 },
      monthlyReviewed: { "2026-06": 1, "2026-07": 2 },
    },
  })),
}));
vi.mock("@/hooks/useNoxlink", () => ({
  useFeedProjects: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(() => ({ selectedOrg: "acme", user: { login: "alice" } })),
}));

import { CurrentTab } from "../CurrentTab";
import { useOpenPRs, useMergedPRs } from "@/hooks/useGitHub";
import { useFeedProjects } from "@/hooks/useNoxlink";

const mOpen = useOpenPRs as unknown as ReturnType<typeof vi.fn>;
const mMerged = useMergedPRs as unknown as ReturnType<typeof vi.fn>;
const mProjects = useFeedProjects as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mOpen.mockReset();
  mMerged.mockReset();
  mProjects.mockReturnValue({ data: [] });
});

function renderTab(repoNames: string[] = ["api"]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CurrentTab repoNames={repoNames} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const samplePR = (over: object = {}) => ({
  id: 1,
  number: 7,
  title: "Fix crash",
  state: "open",
  created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
  updated_at: new Date().toISOString(),
  draft: false,
  head: { ref: "fix", repo: { name: "api" } },
  base: { ref: "main" },
  user: { login: "alice", avatar_url: "" },
  requested_reviewers: [],
  html_url: "https://x",
  ...over,
});

describe("CurrentTab (card grid)", () => {
  it("shows the spinner while open PRs load", () => {
    mOpen.mockReturnValue({ data: undefined, isLoading: true });
    mMerged.mockReturnValue({ data: [], isLoading: false });
    const { container } = renderTab();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("renders the toolbar count when no PRs match (grid still shows every member with 0)", () => {
    mOpen.mockReturnValue({ data: [], isLoading: false });
    mMerged.mockReturnValue({ data: [], isLoading: false });
    renderTab();
    // Empty-state banner is retired — the grid always seeds a card per
    // active member so the tab renders "0 ready PRs" in the toolbar
    // and a card grid rather than a "no PRs" panel.
    expect(screen.getByText(/0 ready PRs?/i)).toBeInTheDocument();
  });

  it("renders a card per author with count", () => {
    mOpen.mockReturnValue({
      data: [samplePR(), samplePR({ id: 2, number: 8, title: "Another", user: { login: "alice", avatar_url: "" } })],
      isLoading: false,
    });
    mMerged.mockReturnValue({ data: [], isLoading: false });
    renderTab();
    // Card labels the group by login.
    expect(screen.getByText("alice")).toBeInTheDocument();
    // Total for alice = 2. It also happens to be avg age = 2 days from the
    // sample fixture, so we just assert at least one "2" is rendered.
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
  });

  it("filters PRs to the logged-in author with the Me toggle", () => {
    mOpen.mockReturnValue({
      data: [samplePR(), samplePR({ id: 2, user: { login: "bob", avatar_url: "" } })],
      isLoading: false,
    });
    mMerged.mockReturnValue({ data: [], isLoading: false });
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Me" }));
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.queryByText("bob")).not.toBeInTheDocument();
  });

  it("clicking Merged switches to the merged card view", () => {
    mOpen.mockReturnValue({ data: [], isLoading: false });
    mMerged.mockReturnValue({
      data: [samplePR({ state: "closed", user: { login: "bob", avatar_url: "" } })],
      isLoading: false,
    });
    renderTab();
    fireEvent.click(screen.getByText("Merged"));
    expect(screen.getByText("bob")).toBeInTheDocument();
  });

  it("clicking a person card drills into the filtered table view", () => {
    mOpen.mockReturnValue({
      data: [samplePR({ title: "Fix crash", user: { login: "alice", avatar_url: "" } })],
      isLoading: false,
    });
    mMerged.mockReturnValue({ data: [], isLoading: false });
    renderTab();
    // Click the alice card.
    fireEvent.click(screen.getByText("alice"));
    // Drill-in view shows the PR title + author + Back button.
    expect(screen.getByText("Fix crash")).toBeInTheDocument();
    expect(screen.getByText(/Back to all/)).toBeInTheDocument();
  });

  it("shows tracked-repository charts in the person stats pane", () => {
    mOpen.mockReturnValue({ data: [samplePR()], isLoading: false });
    mMerged.mockReturnValue({ data: [], isLoading: false });
    renderTab();

    fireEvent.click(screen.getByText("alice"));
    fireEvent.click(screen.getByRole("button", { name: "Stats" }));

    expect(screen.getByText("Contribution activity")).toBeInTheDocument();
    expect(screen.getByText("Tracked repos only")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Daily PR activity bar chart with day and PR count axes/ })).toBeInTheDocument();
    expect(screen.getByText("Last 12 months")).toBeInTheDocument();
    expect(screen.getAllByText("PR count")).toHaveLength(2);
    expect(screen.getByText("Day")).toBeInTheDocument();
    expect(screen.getByText("Month")).toBeInTheDocument();

    const julyOpened = screen.getByLabelText("Jul 3, PRs opened: 4");
    fireEvent.mouseEnter(julyOpened);
    expect(screen.getByText("Jul 3 · Opened")).toBeInTheDocument();
    expect(screen.getByText("4 PRs")).toBeInTheDocument();
    fireEvent.mouseLeave(julyOpened);
    expect(screen.queryByText("Jul 3 · Opened")).not.toBeInTheDocument();
  });

  it("group toggle switches to repo cards", () => {
    mOpen.mockReturnValue({
      data: [samplePR({ head: { ref: "x", repo: { name: "api" } } })],
      isLoading: false,
    });
    mMerged.mockReturnValue({ data: [], isLoading: false });
    renderTab();
    fireEvent.click(screen.getByText("By Repo"));
    expect(screen.getByText("api")).toBeInTheDocument();
  });
});
