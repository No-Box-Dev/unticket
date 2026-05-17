import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useNoxlink", () => ({
  useFeedProjects: vi.fn(),
  useBackfillProjectPrs: vi.fn(),
  useSetProjectArchived: vi.fn(),
  useFeedEvents: vi.fn(),
}));
vi.mock("@/hooks/useGitHub", () => ({
  useAllPRs: vi.fn(),
  useOpenIssues: vi.fn(),
  useClosedIssues: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(),
}));
vi.mock("@/lib/noxlink-api", () => ({
  backfillProjectPrs: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => {
  const qc = { invalidateQueries: vi.fn() };
  return { useQueryClient: () => qc };
});

import { ReposTab } from "../ReposTab";
import {
  useFeedProjects,
  useBackfillProjectPrs,
  useSetProjectArchived,
  useFeedEvents,
} from "@/hooks/useNoxlink";
import { useAllPRs, useOpenIssues, useClosedIssues } from "@/hooks/useGitHub";
import { useAuth } from "@/lib/auth";

const mProjects = useFeedProjects as unknown as ReturnType<typeof vi.fn>;
const mBackfill = useBackfillProjectPrs as unknown as ReturnType<typeof vi.fn>;
const mSetArchived = useSetProjectArchived as unknown as ReturnType<typeof vi.fn>;
const mEvents = useFeedEvents as unknown as ReturnType<typeof vi.fn>;
const mPRs = useAllPRs as unknown as ReturnType<typeof vi.fn>;
const mOpen = useOpenIssues as unknown as ReturnType<typeof vi.fn>;
const mClosed = useClosedIssues as unknown as ReturnType<typeof vi.fn>;
const mAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mProjects.mockReset();
  mBackfill.mockReturnValue({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  mSetArchived.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mEvents.mockReturnValue({ data: [], isLoading: false });
  mPRs.mockReturnValue({ data: [] });
  mOpen.mockReturnValue({ data: [] });
  mClosed.mockReturnValue({ data: [] });
  mAuth.mockReturnValue({ selectedOrg: "acme" });
});

function renderTab() {
  return render(
    <MemoryRouter>
      <ReposTab repoNames={["api"]} />
    </MemoryRouter>,
  );
}

describe("ReposTab", () => {
  it("shows the spinner while projects are loading", () => {
    mProjects.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = renderTab();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("renders 'Failed to load repos.' on error", () => {
    mProjects.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderTab();
    expect(screen.getByText(/Failed to load repos/i)).toBeInTheDocument();
  });

  it("renders the empty state when there are no projects", () => {
    mProjects.mockReturnValue({ data: [], isLoading: false, isError: false });
    renderTab();
    expect(screen.getByText(/No repos yet/i)).toBeInTheDocument();
  });

  it("renders the grid view with repo cards", () => {
    mProjects.mockReturnValue({
      data: [
        {
          id: "p1",
          name: "api",
          org: "acme",
          repo: "api",
          description: "API server",
          narrator_enabled: 1,
          archived: 0,
        },
      ],
      isLoading: false,
      isError: false,
    });
    renderTab();
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByText("API server")).toBeInTheDocument();
  });

  it("clicking a repo card opens its detail view (Back button visible)", () => {
    mProjects.mockReturnValue({
      data: [
        {
          id: "p1",
          name: "api",
          org: "acme",
          repo: "api",
          description: "",
          narrator_enabled: 1,
          archived: 0,
        },
      ],
      isLoading: false,
      isError: false,
    });
    renderTab();
    fireEvent.click(screen.getByText("api"));
    expect(screen.getByText(/All repos/i)).toBeInTheDocument();
  });
});
