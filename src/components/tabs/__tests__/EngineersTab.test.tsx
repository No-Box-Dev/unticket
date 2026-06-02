import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useConfigRepo", () => ({
  usePeople: vi.fn(),
}));
vi.mock("@/hooks/useGitHub", () => ({
  useActiveMembers: vi.fn(),
  useEngineerStats: vi.fn(),
  useEngineerActivity: vi.fn(),
  useGhTeamMemberships: vi.fn(),
  usePaginatedPrs: vi.fn(),
  useReviewPRs: vi.fn(),
  useAssignedIssues: vi.fn(),
}));
vi.mock("@/hooks/useNoxlink", () => ({
  useFeedActors: vi.fn(),
  useFeedEvents: vi.fn(),
}));

import { EngineersTab } from "../EngineersTab";
import { usePeople } from "@/hooks/useConfigRepo";
import {
  useActiveMembers,
  useEngineerStats,
  useEngineerActivity,
  useGhTeamMemberships,
  usePaginatedPrs,
  useReviewPRs,
  useAssignedIssues,
} from "@/hooks/useGitHub";
import { useFeedActors, useFeedEvents } from "@/hooks/useNoxlink";

const mPeople = usePeople as unknown as ReturnType<typeof vi.fn>;
const mMembers = useActiveMembers as unknown as ReturnType<typeof vi.fn>;
const mStats = useEngineerStats as unknown as ReturnType<typeof vi.fn>;
const mActivity = useEngineerActivity as unknown as ReturnType<typeof vi.fn>;
const mTeams = useGhTeamMemberships as unknown as ReturnType<typeof vi.fn>;
const mPaginatedPrs = usePaginatedPrs as unknown as ReturnType<typeof vi.fn>;
const mReview = useReviewPRs as unknown as ReturnType<typeof vi.fn>;
const mAssigned = useAssignedIssues as unknown as ReturnType<typeof vi.fn>;
const mActors = useFeedActors as unknown as ReturnType<typeof vi.fn>;
const mEvents = useFeedEvents as unknown as ReturnType<typeof vi.fn>;

const EMPTY_STATS = {
  openPRs: {},
  reviewing: {},
  assignedIssues: {},
  lifetimePRs: {},
  prsLast4Weeks: {},
  issuesClosed: {},
};

beforeEach(() => {
  mPeople.mockReturnValue({ data: [] });
  mMembers.mockReset();
  mStats.mockReturnValue({ data: EMPTY_STATS, isLoading: false });
  mActivity.mockReturnValue({ data: { login: "", month: "2026-06", firstMonth: null, prsOpened: {}, prsReviewed: {} }, isLoading: false });
  mTeams.mockReturnValue({ data: { memberships: {} } });
  mPaginatedPrs.mockReturnValue({ data: { data: [], totalCount: 0 } });
  mReview.mockReturnValue({ data: [] });
  mAssigned.mockReturnValue({ data: [] });
  mActors.mockReturnValue({ data: [] });
  mEvents.mockReturnValue({ data: [] });
});

function renderTab() {
  return render(
    <MemoryRouter>
      <EngineersTab repoNames={["api"]} />
    </MemoryRouter>,
  );
}

describe("EngineersTab", () => {
  it("shows the spinner while members are loading", () => {
    mMembers.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = renderTab();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("renders the no-members empty state when there are none", () => {
    mMembers.mockReturnValue({ data: [], isLoading: false });
    renderTab();
    expect(screen.getByText(/No organization members found/i)).toBeInTheDocument();
  });

  it("renders one card per org member on the landing grid", () => {
    mMembers.mockReturnValue({
      data: [
        { login: "alice", avatar_url: "https://x/a.png", kind: "human" },
        { login: "bot-1", avatar_url: "https://x/b.png", kind: "bot" },
      ],
      isLoading: false,
    });
    renderTab();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bot-1")).toBeInTheDocument();
  });

  it("shows per-member counts from useEngineerStats on the cards", () => {
    mMembers.mockReturnValue({
      data: [{ login: "alice", avatar_url: "https://x/a.png", kind: "human" }],
      isLoading: false,
    });
    mStats.mockReturnValue({
      data: {
        ...EMPTY_STATS,
        openPRs: { alice: 3 },
        reviewing: { alice: 2 },
        assignedIssues: { alice: 5 },
      },
      isLoading: false,
    });
    renderTab();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });
});
