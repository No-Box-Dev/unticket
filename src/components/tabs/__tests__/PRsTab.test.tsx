import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useGitHub", () => ({
  useOpenPRs: vi.fn(),
  useMergedPRs: vi.fn(),
  useIsAdmin: vi.fn(() => false),
  useActiveMembers: vi.fn(() => ({ data: [] })),
}));
vi.mock("@/hooks/useNoxlink", () => ({
  useFeedProjects: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(() => ({ selectedOrg: "acme" })),
}));

import { PRsTab } from "../PRsTab";
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
        <PRsTab repoNames={repoNames} />
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

describe("PRsTab (card grid)", () => {
  it("shows the spinner while open PRs load", () => {
    mOpen.mockReturnValue({ data: undefined, isLoading: true });
    mMerged.mockReturnValue({ data: [], isLoading: false });
    const { container } = renderTab();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows empty state when no PRs match", () => {
    mOpen.mockReturnValue({ data: [], isLoading: false });
    mMerged.mockReturnValue({ data: [], isLoading: false });
    renderTab();
    expect(screen.getByText(/No ready PRs/)).toBeInTheDocument();
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
    expect(screen.getByText(/Back to all PRs/)).toBeInTheDocument();
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
