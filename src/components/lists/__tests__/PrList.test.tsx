import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useGitHub", () => ({
  usePaginatedPrs: vi.fn(),
}));

import { PrList } from "../PrList";
import { usePaginatedPrs } from "@/hooks/useGitHub";

const mockHook = usePaginatedPrs as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockHook.mockReset();
});

function renderList(props: Partial<React.ComponentProps<typeof PrList>> = {}) {
  return render(
    <MemoryRouter>
      <PrList filter={{ state: "open" }} {...props} />
    </MemoryRouter>,
  );
}

describe("PrList", () => {
  it("renders a spinner while loading", () => {
    mockHook.mockReturnValue({ data: undefined, isLoading: true, isFetching: true });
    const { container } = renderList();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("renders the empty state when totalCount is 0", () => {
    mockHook.mockReturnValue({ data: { data: [], totalCount: 0 }, isLoading: false, isFetching: false });
    renderList({ emptyMessage: "Nothing to review" });
    expect(screen.getByText("Nothing to review")).toBeInTheDocument();
  });

  it("renders one row per PR with title, author, repo, age", () => {
    mockHook.mockReturnValue({
      data: {
        totalCount: 1,
        data: [
          {
            id: 99,
            number: 7,
            title: "Fix crash",
            state: "open",
            created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
            repo: "api",
            user: { login: "alice" },
            requested_reviewers: [{ login: "bob" }],
            html_url: "https://x",
            head: { ref: "fix" },
            base: { ref: "main" },
          },
        ],
      },
      isLoading: false,
      isFetching: false,
    });
    renderList();
    expect(screen.getByText("Fix crash")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText("2d")).toBeInTheDocument();
    expect(screen.getByText("api")).toBeInTheDocument();
  });

  it("renders title prop and total count (singular vs plural)", () => {
    mockHook.mockReturnValue({
      data: { data: [], totalCount: 1 },
      isLoading: false,
      isFetching: false,
    });
    renderList({ title: "Open PRs" });
    expect(screen.getByText("Open PRs")).toBeInTheDocument();
    expect(screen.getByText("1 PR")).toBeInTheDocument();
  });

  it("renders the 'draft' chip for draft PRs", () => {
    mockHook.mockReturnValue({
      data: {
        totalCount: 1,
        data: [
          {
            id: 1,
            number: 7,
            title: "WIP",
            state: "open",
            draft: true,
            created_at: new Date().toISOString(),
            repo: "api",
            user: { login: "alice" },
            requested_reviewers: [],
            html_url: "https://x",
          },
        ],
      },
      isLoading: false,
      isFetching: false,
    });
    renderList();
    expect(screen.getByText("draft")).toBeInTheDocument();
  });

  it("shows 'none' when there are no requested reviewers", () => {
    mockHook.mockReturnValue({
      data: {
        totalCount: 1,
        data: [
          {
            id: 1,
            number: 7,
            title: "Fix",
            state: "open",
            created_at: new Date().toISOString(),
            repo: "api",
            user: { login: "alice" },
            requested_reviewers: [],
            html_url: "https://x",
          },
        ],
      },
      isLoading: false,
      isFetching: false,
    });
    renderList();
    expect(screen.getByText("none")).toBeInTheDocument();
  });

  it("renders pagination when totalPages > 1", () => {
    mockHook.mockReturnValue({
      data: { data: [], totalCount: 90 },
      isLoading: false,
      isFetching: false,
    });
    renderList({ pageSize: 30 });
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
  });
});
