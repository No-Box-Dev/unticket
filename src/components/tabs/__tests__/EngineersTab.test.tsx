import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useConfigRepo", () => ({
  usePeople: vi.fn(),
}));
vi.mock("@/hooks/useGitHub", () => ({
  useActiveMembers: vi.fn(),
  useAllPRs: vi.fn(),
  useClosedIssues: vi.fn(),
  useOpenIssues: vi.fn(),
  useGhTeamMemberships: vi.fn(),
}));
vi.mock("@/hooks/useNoxlink", () => ({
  useFeedActors: vi.fn(),
  useFeedEvents: vi.fn(),
}));

import { EngineersTab } from "../EngineersTab";
import { usePeople } from "@/hooks/useConfigRepo";
import {
  useActiveMembers,
  useAllPRs,
  useClosedIssues,
  useOpenIssues,
  useGhTeamMemberships,
} from "@/hooks/useGitHub";
import { useFeedActors, useFeedEvents } from "@/hooks/useNoxlink";

const mPeople = usePeople as unknown as ReturnType<typeof vi.fn>;
const mMembers = useActiveMembers as unknown as ReturnType<typeof vi.fn>;
const mPRs = useAllPRs as unknown as ReturnType<typeof vi.fn>;
const mClosed = useClosedIssues as unknown as ReturnType<typeof vi.fn>;
const mOpen = useOpenIssues as unknown as ReturnType<typeof vi.fn>;
const mTeams = useGhTeamMemberships as unknown as ReturnType<typeof vi.fn>;
const mActors = useFeedActors as unknown as ReturnType<typeof vi.fn>;
const mEvents = useFeedEvents as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mPeople.mockReturnValue({ data: [] });
  mMembers.mockReset();
  mPRs.mockReturnValue({ data: [] });
  mClosed.mockReturnValue({ data: [] });
  mOpen.mockReturnValue({ data: [] });
  mTeams.mockReturnValue({ data: { memberships: {} } });
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
});
