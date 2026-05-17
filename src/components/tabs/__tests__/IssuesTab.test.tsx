import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useGitHub", () => ({
  usePaginatedIssues: vi.fn(),
  useIssueLabels: vi.fn(),
  useRepos: vi.fn(),
  useActiveMembers: vi.fn(),
  useUpdateIssueAssignees: vi.fn(),
  useIssueStats: vi.fn(),
}));
vi.mock("@/hooks/useConfigRepo", () => ({
  useSettings: vi.fn(),
}));
vi.mock("@/hooks/useNoxlink", () => ({
  useFeedProjects: vi.fn(),
}));

import { IssuesTab } from "../IssuesTab";
import {
  usePaginatedIssues,
  useIssueLabels,
  useRepos,
  useActiveMembers,
  useUpdateIssueAssignees,
  useIssueStats,
} from "@/hooks/useGitHub";
import { useSettings } from "@/hooks/useConfigRepo";
import { useFeedProjects } from "@/hooks/useNoxlink";

const mIssues = usePaginatedIssues as unknown as ReturnType<typeof vi.fn>;
const mLabels = useIssueLabels as unknown as ReturnType<typeof vi.fn>;
const mRepos = useRepos as unknown as ReturnType<typeof vi.fn>;
const mMembers = useActiveMembers as unknown as ReturnType<typeof vi.fn>;
const mUpdateA = useUpdateIssueAssignees as unknown as ReturnType<typeof vi.fn>;
const mStats = useIssueStats as unknown as ReturnType<typeof vi.fn>;
const mSettings = useSettings as unknown as ReturnType<typeof vi.fn>;
const mProjects = useFeedProjects as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mIssues.mockReset();
  mLabels.mockReturnValue({ data: [] });
  mRepos.mockReturnValue({ data: [{ name: "api" }] });
  mMembers.mockReturnValue({ data: [] });
  mUpdateA.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mStats.mockReturnValue({ data: { byRepo: [], total: 0 } });
  mSettings.mockReturnValue({ data: { draftRepos: [] } });
  mProjects.mockReturnValue({ data: [] });
});

function renderTab() {
  return render(
    <MemoryRouter>
      <IssuesTab repoNames={["api"]} />
    </MemoryRouter>,
  );
}

describe("IssuesTab", () => {
  it("renders 'Open Issues by Repo' header", () => {
    mIssues.mockReturnValue({ data: { data: [], totalCount: 0 }, isLoading: false, isFetching: false });
    renderTab();
    expect(screen.getByText(/Open Issues by Repo/i)).toBeInTheDocument();
  });

  it("renders the issue rows when issues come back", () => {
    mIssues.mockImplementation(({ state }: { state?: string }) => {
      if (state === "open") {
        return {
          data: {
            totalCount: 1,
            data: [
              {
                id: 1,
                number: 11,
                title: "Fix login",
                state: "open",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                repo: "api",
                assignees: [],
                labels: [],
                html_url: "https://x",
              },
            ],
          },
          isLoading: false,
          isFetching: false,
        };
      }
      return { data: { data: [], totalCount: 0 }, isLoading: false, isFetching: false };
    });
    renderTab();
    expect(screen.getAllByText("Fix login").length).toBeGreaterThan(0);
  });

  it("shows the critical issues banner when there are critical issues", () => {
    mIssues.mockImplementation(({ label }: { label?: string }) => {
      if (label === "critical") {
        return {
          data: {
            totalCount: 1,
            data: [
              {
                id: 99,
                number: 7,
                title: "Crash on prod",
                state: "open",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                repo: "api",
                assignees: [],
                labels: [{ name: "critical", color: "ff0000" }],
                html_url: "https://x",
              },
            ],
          },
          isLoading: false,
          isFetching: false,
        };
      }
      return { data: { data: [], totalCount: 0 }, isLoading: false, isFetching: false };
    });
    renderTab();
    expect(screen.getByText(/Critical Issues/i)).toBeInTheDocument();
  });
});
