import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useGitHub", () => ({
  useOpenPRs: vi.fn(),
  useMergedPRs: vi.fn(),
  usePRStats: vi.fn(),
}));
vi.mock("@/hooks/useNoxlink", () => ({
  useFeedProjects: vi.fn(),
}));

import { PRsTab } from "../PRsTab";
import { useOpenPRs, useMergedPRs, usePRStats } from "@/hooks/useGitHub";
import { useFeedProjects } from "@/hooks/useNoxlink";

const mOpen = useOpenPRs as unknown as ReturnType<typeof vi.fn>;
const mMerged = useMergedPRs as unknown as ReturnType<typeof vi.fn>;
const mStats = usePRStats as unknown as ReturnType<typeof vi.fn>;
const mProjects = useFeedProjects as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mOpen.mockReset();
  mMerged.mockReset();
  mStats.mockReturnValue({ data: { byRepo: [] } });
  mProjects.mockReturnValue({ data: [] });
});

function renderTab(repoNames: string[] = ["api"]) {
  return render(
    <MemoryRouter>
      <PRsTab repoNames={repoNames} />
    </MemoryRouter>,
  );
}

describe("PRsTab", () => {
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
    expect(screen.getByText(/No pull requests found/)).toBeInTheDocument();
  });

  it("renders one row per open PR with title and author", () => {
    mOpen.mockReturnValue({
      data: [
        {
          id: 1,
          number: 7,
          title: "Fix crash",
          state: "open",
          created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
          head: { ref: "fix", repo: { name: "api" } },
          base: { ref: "main" },
          user: { login: "alice" },
          requested_reviewers: [],
          html_url: "https://x",
        },
      ],
      isLoading: false,
    });
    mMerged.mockReturnValue({ data: [], isLoading: false });
    renderTab();
    expect(screen.getByText("Fix crash")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("clicking Merged switches the view to merged PRs", () => {
    mOpen.mockReturnValue({ data: [], isLoading: false });
    mMerged.mockReturnValue({
      data: [
        {
          id: 2,
          number: 8,
          title: "Refactor",
          state: "closed",
          merged_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          head: { ref: "rf", repo: { name: "api" } },
          base: { ref: "main" },
          user: { login: "bob" },
          requested_reviewers: [],
          html_url: "https://x",
        },
      ],
      isLoading: false,
    });
    renderTab();
    fireEvent.click(screen.getByText("Merged"));
    expect(screen.getByText("Refactor")).toBeInTheDocument();
  });
});
