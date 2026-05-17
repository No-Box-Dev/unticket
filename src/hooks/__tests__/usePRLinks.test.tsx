import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createQueryWrapper } from "@/test/helpers";

vi.mock("@/lib/pr-links", () => ({
  fetchLinkedPRs: vi.fn(),
  fetchLinkedFeatures: vi.fn(),
  linkPR: vi.fn(),
  unlinkPR: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(),
}));

import { fetchLinkedPRs, fetchLinkedFeatures, linkPR, unlinkPR } from "@/lib/pr-links";
import { useAuth } from "@/lib/auth";
import { useLinkedPRs, useLinkedFeatures, useLinkPR, useUnlinkPR } from "../usePRLinks";

const mockUseAuth = vi.mocked(useAuth);
const mockFetchLinkedPRs = vi.mocked(fetchLinkedPRs);
const mockFetchLinkedFeatures = vi.mocked(fetchLinkedFeatures);
const mockLinkPR = vi.mocked(linkPR);
const mockUnlinkPR = vi.mocked(unlinkPR);

const authValue = {
  selectedOrg: "my-org",
  user: { login: "alice", avatar_url: "", name: null },
  isLoading: false,
  authError: null,
  authMode: "oauth" as const,
  loginWithToken: vi.fn(),
  loginWithOAuth: vi.fn(),
  logout: vi.fn(),
  setSelectedOrg: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue(authValue);
});
afterEach(() => vi.restoreAllMocks());

describe("useLinkedPRs", () => {
  it("does not run when featureNumber is undefined", async () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useLinkedPRs(undefined), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(mockFetchLinkedPRs).not.toHaveBeenCalled();
  });

  it("does not run when org is missing", async () => {
    mockUseAuth.mockReturnValue({ ...authValue, selectedOrg: null });
    const { wrapper } = createQueryWrapper();
    renderHook(() => useLinkedPRs(42), { wrapper });
    expect(mockFetchLinkedPRs).not.toHaveBeenCalled();
  });

  it("fetches when both org and featureNumber are present", async () => {
    mockFetchLinkedPRs.mockResolvedValue([{ repo: "api", number: 100 }] as never);
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useLinkedPRs(42), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetchLinkedPRs).toHaveBeenCalledWith(42);
    expect(result.current.data).toEqual([{ repo: "api", number: 100 }]);
  });
});

describe("useLinkedFeatures", () => {
  it("does not run when repo or number is missing", async () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => useLinkedFeatures(undefined, 1), { wrapper });
    renderHook(() => useLinkedFeatures("api", undefined), { wrapper });
    expect(mockFetchLinkedFeatures).not.toHaveBeenCalled();
  });

  it("fetches with repo + number args", async () => {
    mockFetchLinkedFeatures.mockResolvedValue([{ feature_number: 42 }] as never);
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useLinkedFeatures("api", 100), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetchLinkedFeatures).toHaveBeenCalledWith("api", 100);
  });
});

describe("useLinkPR", () => {
  it("invalidates linkedPRs / linkedFeatures / features on success", async () => {
    mockLinkPR.mockResolvedValue({ ok: true });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useLinkPR(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ featureNumber: 5, prRepo: "api", prNumber: 100 });
    });

    expect(mockLinkPR).toHaveBeenCalledWith(5, "api", 100);
    const invalidatedKeys = invalidate.mock.calls.map((c) => c[0]?.queryKey?.[0]);
    expect(invalidatedKeys).toContain("linkedPRs");
    expect(invalidatedKeys).toContain("linkedFeatures");
    expect(invalidatedKeys).toContain("features");
  });
});

describe("useUnlinkPR", () => {
  it("calls unlinkPR + invalidates the same three keys on success", async () => {
    mockUnlinkPR.mockResolvedValue(undefined as any);
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUnlinkPR(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ featureNumber: 5, prRepo: "api", prNumber: 100 });
    });
    expect(mockUnlinkPR).toHaveBeenCalledWith(5, "api", 100);
    const keys = invalidate.mock.calls.map((c) => c[0]?.queryKey?.[0]);
    expect(keys).toEqual(expect.arrayContaining(["linkedPRs", "linkedFeatures", "features"]));
  });

  it("does NOT invalidate when the mutation fails", async () => {
    mockUnlinkPR.mockRejectedValue(new Error("nope"));
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUnlinkPR(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ featureNumber: 5, prRepo: "api", prNumber: 100 }).catch(() => {});
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
