import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

vi.mock("@/hooks/useGitHub", () => ({
  useIssueDetail: vi.fn(),
  useIssueBody: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ useAuth: vi.fn() }));
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="md">{children}</div>,
}));

import { IssueDetailPage } from "../IssueDetailPage";
import { useIssueDetail, useIssueBody } from "@/hooks/useGitHub";
import { useAuth } from "@/lib/auth";

const mDetail = useIssueDetail as unknown as ReturnType<typeof vi.fn>;
const mBody = useIssueBody as unknown as ReturnType<typeof vi.fn>;
const mAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}</div>;
}

beforeEach(() => {
  mDetail.mockReset();
  mBody.mockReset();
  mAuth.mockReturnValue({ selectedOrg: "acme" });
});

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/issues/:repo/:number" element={<IssueDetailPage />} />
        <Route path="/" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("IssueDetailPage", () => {
  it("redirects to / when :number is not a valid integer", () => {
    mDetail.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    mBody.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    renderAt("/issues/api/abc");
    expect(screen.getByTestId("loc").textContent).toBe("/");
  });

  it("shows the spinner while loading", () => {
    mDetail.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mBody.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = renderAt("/issues/api/3");
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("renders error fallback with GitHub link when detail load fails", () => {
    mDetail.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    mBody.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    renderAt("/issues/api/3");
    expect(screen.getByText(/Couldn't load this issue/i)).toBeInTheDocument();
    expect(screen.getByText(/View on GitHub/i)).toBeInTheDocument();
  });

  it("renders the issue header, body, labels and critical badge", () => {
    mDetail.mockReturnValue({
      data: {
        number: 11,
        title: "Crash on prod",
        state: "open",
        repo: "api",
        user: { login: "alice", avatar_url: "https://x/a.png" },
        created_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
        labels: [{ name: "critical", color: "ff0000" }, { name: "bug", color: "ee0000" }],
        assignees: [{ login: "bob", avatar_url: "https://x/b.png" }],
        html_url: "https://github.com/acme/api/issues/11",
      },
      isLoading: false,
      isError: false,
    });
    mBody.mockReturnValue({
      data: { body: "Steps to reproduce…", comments: 4 },
      isLoading: false,
      isError: false,
    });
    renderAt("/issues/api/11");
    expect(screen.getByText("Crash on prod")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    // Both the critical badge and the "critical" label match — assert >1 match.
    expect(screen.getAllByText(/critical/i).length).toBeGreaterThan(0);
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.getByTestId("md")).toHaveTextContent("Steps to reproduce");
    expect(screen.getByText(/4 comment/i)).toBeInTheDocument();
  });

  it("renders 'No description.' when the body is empty", () => {
    mDetail.mockReturnValue({
      data: {
        number: 11,
        title: "Empty body",
        state: "open",
        repo: "api",
        user: { login: "alice" },
        created_at: new Date().toISOString(),
        labels: [],
        assignees: [],
        html_url: "https://x",
      },
      isLoading: false,
      isError: false,
    });
    mBody.mockReturnValue({
      data: { body: "", comments: 0 },
      isLoading: false,
      isError: false,
    });
    renderAt("/issues/api/11");
    expect(screen.getByText(/No description/i)).toBeInTheDocument();
  });
});
