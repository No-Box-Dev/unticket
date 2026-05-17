import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useGitHub", () => ({
  usePaginatedIssues: vi.fn(),
}));

import { IssueList } from "../IssueList";
import { usePaginatedIssues } from "@/hooks/useGitHub";

const mockHook = usePaginatedIssues as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockHook.mockReset();
});

function renderList(props: Partial<React.ComponentProps<typeof IssueList>> = {}) {
  return render(
    <MemoryRouter>
      <IssueList filter={{ state: "open" }} {...props} />
    </MemoryRouter>,
  );
}

describe("IssueList", () => {
  it("renders a spinner while loading", () => {
    mockHook.mockReturnValue({ data: undefined, isLoading: true, isFetching: true });
    const { container } = renderList();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("renders the empty state when total is 0", () => {
    mockHook.mockReturnValue({ data: { data: [], totalCount: 0 }, isLoading: false, isFetching: false });
    renderList({ emptyMessage: "Nothing here" });
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("renders one row per issue with title, repo, age", () => {
    mockHook.mockReturnValue({
      data: {
        totalCount: 1,
        data: [
          {
            id: 1,
            number: 7,
            title: "Crash on save",
            repo: "api",
            state: "open",
            created_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
            labels: [{ name: "bug", color: "ff0000" }],
            assignees: [],
            html_url: "https://x",
          },
        ],
      },
      isLoading: false,
      isFetching: false,
    });
    renderList();
    expect(screen.getByText("Crash on save")).toBeInTheDocument();
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByText("#7")).toBeInTheDocument();
    expect(screen.getByText("3d")).toBeInTheDocument();
    expect(screen.getByText("bug")).toBeInTheDocument();
  });

  it("renders the title prop and total count", () => {
    mockHook.mockReturnValue({
      data: { data: [], totalCount: 5 },
      isLoading: false,
      isFetching: false,
    });
    renderList({ title: "Open issues" });
    expect(screen.getByText("Open issues")).toBeInTheDocument();
    expect(screen.getByText("5 issues")).toBeInTheDocument();
  });

  it("clicking a sortable header toggles direction or sets a new sort key", () => {
    mockHook.mockReturnValue({
      data: { data: [], totalCount: 0 },
      isLoading: false,
      isFetching: false,
    });
    renderList();
    // Default sort is updated_at desc. Click "Title" header to switch.
    fireEvent.click(screen.getByText(/Title/i));
    // After the click, the hook should have been called with sort: "title", sortDir: "desc"
    const last = mockHook.mock.calls.at(-1)![0];
    expect(last.sort).toBe("title");
    expect(last.sortDir).toBe("desc");
  });

  it("pagination renders when totalPages > 1", () => {
    mockHook.mockReturnValue({
      data: { data: [], totalCount: 60 },
      isLoading: false,
      isFetching: false,
    });
    renderList({ pageSize: 30 });
    expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
  });

  it("hides repo column when showRepoColumn=false", () => {
    mockHook.mockReturnValue({
      data: { data: [], totalCount: 0 },
      isLoading: false,
      isFetching: false,
    });
    renderList({ showRepoColumn: false });
    expect(screen.queryByText(/^Repo/)).toBeNull();
  });
});
