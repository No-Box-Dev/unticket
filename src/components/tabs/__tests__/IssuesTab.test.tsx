import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useGitHub", () => ({
  useOpenIssues: vi.fn(),
  useClosedIssues: vi.fn(),
  useActiveMembers: vi.fn(),
  useRepos: vi.fn(),
  useUpdateIssueAssignees: vi.fn(),
  usePaginatedIssues: vi.fn(),
}));
vi.mock("@/hooks/useNoxlink", () => ({
  useFeedProjects: vi.fn(),
}));

import { IssuesTab } from "../IssuesTab";
import {
  useOpenIssues,
  useClosedIssues,
  useActiveMembers,
  useRepos,
  useUpdateIssueAssignees,
  usePaginatedIssues,
} from "@/hooks/useGitHub";
import { useFeedProjects } from "@/hooks/useNoxlink";

const mOpen = useOpenIssues as unknown as ReturnType<typeof vi.fn>;
const mClosed = useClosedIssues as unknown as ReturnType<typeof vi.fn>;
const mMembers = useActiveMembers as unknown as ReturnType<typeof vi.fn>;
const mRepos = useRepos as unknown as ReturnType<typeof vi.fn>;
const mUpdateA = useUpdateIssueAssignees as unknown as ReturnType<typeof vi.fn>;
const mPaginated = usePaginatedIssues as unknown as ReturnType<typeof vi.fn>;
const mProjects = useFeedProjects as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mOpen.mockReset();
  mClosed.mockReset();
  mMembers.mockReturnValue({ data: [] });
  mRepos.mockReturnValue({ data: [{ name: "api" }] });
  mUpdateA.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mPaginated.mockReturnValue({ data: { data: [], totalCount: 0 }, isLoading: false });
  mProjects.mockReturnValue({ data: [] });
});

const issue = (over: object = {}) => ({
  id: 1,
  number: 11,
  title: "Fix login",
  state: "open",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  repo: "api",
  assignees: [{ login: "alice", avatar_url: "" }],
  labels: [],
  html_url: "https://x",
  ...over,
});

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IssuesTab repoNames={["api"]} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("IssuesTab (card grid)", () => {
  it("renders the toolbar count when no issues match (grid still shows every repo with 0)", () => {
    mOpen.mockReturnValue({ data: [], isLoading: false });
    mClosed.mockReturnValue({ data: [], isLoading: false });
    renderTab();
    // Empty-state banner is retired — the grid always seeds a card per
    // active repo/member so the tab renders "0 open issues" in the
    // toolbar and a card grid rather than a "no issues" panel.
    expect(screen.getByText(/0 open issues?/i)).toBeInTheDocument();
  });

  it("renders a card per assignee with issue count", () => {
    mOpen.mockReturnValue({
      data: [issue(), issue({ id: 2, number: 12, title: "Second" })],
      isLoading: false,
    });
    mClosed.mockReturnValue({ data: [], isLoading: false });
    renderTab();
    expect(screen.getByText("alice")).toBeInTheDocument();
    // Total count of 2 is rendered on the alice card.
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
  });

  it("shows an Unassigned card when issues have no assignees", () => {
    mOpen.mockReturnValue({
      data: [issue({ assignees: [] })],
      isLoading: false,
    });
    mClosed.mockReturnValue({ data: [], isLoading: false });
    renderTab();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("clicking a person card drills into the filtered list", () => {
    mOpen.mockReturnValue({ data: [issue()], isLoading: false });
    mClosed.mockReturnValue({ data: [], isLoading: false });
    renderTab();
    fireEvent.click(screen.getByText("alice"));
    expect(screen.getByText(/Back to all issues/)).toBeInTheDocument();
    expect(screen.getByText("Fix login")).toBeInTheDocument();
  });

  it("By Repo toggle switches to repo-grouped cards", () => {
    mOpen.mockReturnValue({ data: [issue()], isLoading: false });
    mClosed.mockReturnValue({ data: [], isLoading: false });
    renderTab();
    fireEvent.click(screen.getByText("By Repo"));
    expect(screen.getByText("api")).toBeInTheDocument();
  });

  it("shows the critical banner when a critical issue exists", () => {
    mOpen.mockReturnValue({ data: [], isLoading: false });
    mClosed.mockReturnValue({ data: [], isLoading: false });
    mPaginated.mockImplementation(({ label }: { label?: string }) => {
      if (label === "critical") {
        return {
          data: {
            totalCount: 1,
            data: [issue({ id: 99, number: 7, title: "Crash on prod", labels: [{ name: "critical", color: "ff0000" }] })],
          },
          isLoading: false,
        };
      }
      return { data: { data: [], totalCount: 0 }, isLoading: false };
    });
    renderTab();
    expect(screen.getByText(/critical issue/i)).toBeInTheDocument();
  });
});
