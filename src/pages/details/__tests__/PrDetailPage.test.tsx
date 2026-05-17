import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

vi.mock("@/hooks/useGitHub", () => ({
  usePrDetail: vi.fn(),
  usePrBody: vi.fn(),
}));
vi.mock("@/hooks/usePRLinks", () => ({
  useLinkedFeatures: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ useAuth: vi.fn() }));
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="md">{children}</div>,
}));

import { PrDetailPage } from "../PrDetailPage";
import { usePrDetail, usePrBody } from "@/hooks/useGitHub";
import { useLinkedFeatures } from "@/hooks/usePRLinks";
import { useAuth } from "@/lib/auth";

const mDetail = usePrDetail as unknown as ReturnType<typeof vi.fn>;
const mBody = usePrBody as unknown as ReturnType<typeof vi.fn>;
const mLinked = useLinkedFeatures as unknown as ReturnType<typeof vi.fn>;
const mAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}</div>;
}

beforeEach(() => {
  mDetail.mockReset();
  mBody.mockReset();
  mLinked.mockReturnValue({ data: [] });
  mAuth.mockReturnValue({ selectedOrg: "acme" });
});

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/prs/:repo/:number" element={<PrDetailPage />} />
        <Route path="/" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PrDetailPage", () => {
  it("redirects to / when the :number param is not a valid integer", () => {
    mDetail.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    mBody.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    renderAt("/prs/api/not-a-number");
    expect(screen.getByTestId("loc").textContent).toBe("/");
  });

  it("shows the spinner while loading", () => {
    mDetail.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mBody.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = renderAt("/prs/api/7");
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("renders the error fallback when the detail query fails", () => {
    mDetail.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    mBody.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    renderAt("/prs/api/7");
    expect(screen.getByText(/Couldn't load this pull request/i)).toBeInTheDocument();
    expect(screen.getByText(/View on GitHub/i)).toBeInTheDocument();
  });

  it("renders the PR header, body, and metadata when data is present", () => {
    mDetail.mockReturnValue({
      data: {
        number: 7,
        title: "Fix crash",
        state: "open",
        repo: "api",
        user: { login: "alice", avatar_url: "https://x/a.png" },
        created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
        head: { ref: "fix" },
        base: { ref: "main" },
        requested_reviewers: [{ login: "bob" }],
        labels: [{ name: "bug", color: "ff0000" }],
        html_url: "https://github.com/acme/api/pull/7",
      },
      isLoading: false,
      isError: false,
    });
    mBody.mockReturnValue({
      data: {
        body: "## What\nFixes it",
        comments: 2,
        review_comments: 1,
        additions: 10,
        deletions: 3,
        changed_files: 2,
      },
      isLoading: false,
      isError: false,
    });
    mLinked.mockReturnValue({
      data: [{ feature_number: 42, feature_title: "Add login" }],
    });
    renderAt("/prs/api/7");
    expect(screen.getByText("Fix crash")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.getByText(/#42 Add login/)).toBeInTheDocument();
    expect(screen.getByTestId("md")).toHaveTextContent("Fixes it");
  });
});
