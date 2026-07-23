import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/helpers";

vi.mock("@/lib/github", () => ({
  fetchRepos: vi.fn(),
  fetchSyncStatus: vi.fn(),
  triggerSync: vi.fn(),
  fetchOrgs: vi.fn(),
  fetchOpenPRs: vi.fn(),
  fetchOpenIssues: vi.fn(),
  fetchClosedIssues: vi.fn(),
  fetchMergedPRs: vi.fn(),
  fetchAllPRs: vi.fn(),
  fetchAllIssues: vi.fn(),
  fetchOrgMembers: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(),
}));

import { fetchRepos, triggerSync, fetchSyncStatus } from "@/lib/github";
import { useAuth } from "@/lib/auth";
import { useRepos, useTriggerSync, useSyncStatus } from "../useGitHub";

const mockUseAuth = vi.mocked(useAuth);
const mockFetchRepos = vi.mocked(fetchRepos);
const mockTriggerSync = vi.mocked(triggerSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useRepos", () => {
  it("disabled when selectedOrg is null", () => {
    mockUseAuth.mockReturnValue({
      selectedOrg: null,
      user: null,
      isLoading: false,
      authError: null,
      loginWithOAuth: vi.fn(),
      logout: vi.fn(),
      setSelectedOrg: vi.fn(),
    });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useRepos(), { wrapper });
    expect(result.current.isFetching).toBe(false);
    expect(mockFetchRepos).not.toHaveBeenCalled();
  });

  it("fetches when selectedOrg is set", async () => {
    mockUseAuth.mockReturnValue({
      selectedOrg: "my-org",
      user: { login: "alice", avatar_url: "", name: null },
      isLoading: false,
      authError: null,
      loginWithOAuth: vi.fn(),
      logout: vi.fn(),
      setSelectedOrg: vi.fn(),
    });
    mockFetchRepos.mockResolvedValue([{
      id: 0,
      name: "r",
      full_name: "r",
      description: null,
      open_issues_count: 0,
      pushed_at: null,
      language: null,
      visibility: "private",
      inactive: false,
      discoveredAt: null,
      acknowledgedAt: null,
      retiredAt: null,
      retirementReason: null,
      transferredTo: null,
    }]);

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useRepos(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });
});

describe("useTriggerSync", () => {
  it("invalidates cache keys on success", async () => {
    mockUseAuth.mockReturnValue({
      selectedOrg: "my-org",
      user: { login: "alice", avatar_url: "", name: null },
      isLoading: false,
      authError: null,
      loginWithOAuth: vi.fn(),
      logout: vi.fn(),
      setSelectedOrg: vi.fn(),
    });
    mockTriggerSync.mockResolvedValue({ ok: true, synced: { repos: 1, prs: 0, issues: 0, members: 0 } });

    const { wrapper, queryClient } = createQueryWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useTriggerSync(), { wrapper });

    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Should invalidate multiple query keys
    expect(invalidateSpy).toHaveBeenCalled();
    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (c) => (c[0] as { queryKey: string[] }).queryKey[0],
    );
    expect(invalidatedKeys).toContain("repos");
    expect(invalidatedKeys).toContain("syncStatus");
  });
});

describe("useSyncStatus", () => {
  it("starts fetching when selectedOrg is set", () => {
    mockUseAuth.mockReturnValue({
      selectedOrg: "my-org",
      user: { login: "alice", avatar_url: "", name: null },
      isLoading: false,
      authError: null,
      loginWithOAuth: vi.fn(),
      logout: vi.fn(),
      setSelectedOrg: vi.fn(),
    });
    vi.mocked(fetchSyncStatus).mockResolvedValue({ isStale: false, lastSync: null });

    const { wrapper } = createQueryWrapper();
    // We verify the hook configures the interval by checking it fetches.
    // The actual interval value is set in source code as 60_000.
    const { result } = renderHook(() => useSyncStatus(), { wrapper });
    expect(result.current.isFetching).toBe(true);
  });
});
