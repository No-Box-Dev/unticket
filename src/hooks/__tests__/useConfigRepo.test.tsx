import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createQueryWrapper } from "@/test/helpers";

vi.mock("@/lib/config-repo", () => ({
  fetchFeatures: vi.fn(),
  saveFeatures: vi.fn(),
  createConfigRepo: vi.fn(),
  fetchSprint: vi.fn(),
  saveSprint: vi.fn(),
  fetchPeople: vi.fn(),
  savePeople: vi.fn(),
  fetchSettings: vi.fn(),
  saveSettings: vi.fn(),
  fetchTodos: vi.fn(),
  saveTodos: vi.fn(),
  ensureConfigRepo: vi.fn(),
  fetchPlanFile: vi.fn(),
  planFilePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(),
}));

import { saveFeatures, createConfigRepo as createConfigRepoFn } from "@/lib/config-repo";
import { useAuth } from "@/lib/auth";
import { useSaveFeatures, useCreateConfigRepo } from "../useConfigRepo";
import type { Feature } from "@/lib/types";

const mockUseAuth = vi.mocked(useAuth);
const mockSaveFeatures = vi.mocked(saveFeatures);
const mockCreateConfigRepo = vi.mocked(createConfigRepoFn);

const authValue = {
  selectedOrg: "my-org",
  user: { login: "alice", avatar_url: "", name: null },
  isLoading: false,
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

describe("useSaveFeatures", () => {
  const oldFeatures: Feature[] = [
    { id: "f1", title: "Old", owners: [], status: "plan", sprint: 1, effort: "low" },
  ];
  const newFeatures: Feature[] = [
    { id: "f1", title: "Updated", owners: [], status: "demo", sprint: 1, effort: "low" },
  ];

  it("optimistically updates cache", async () => {
    mockSaveFeatures.mockResolvedValue(undefined);

    const { wrapper, queryClient } = createQueryWrapper();
    // Seed the cache
    queryClient.setQueryData(["features", "my-org"], oldFeatures);

    const { result } = renderHook(() => useSaveFeatures(), { wrapper });

    await act(async () => {
      result.current.mutate(newFeatures);
    });

    // Cache should be optimistically updated before mutation settles
    await waitFor(() => {
      const cached = queryClient.getQueryData<Feature[]>(["features", "my-org"]);
      expect(cached?.[0].title).toBe("Updated");
    });
  });

  it("rolls back on error", async () => {
    mockSaveFeatures.mockRejectedValue(new Error("fail"));

    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(["features", "my-org"], oldFeatures);

    const { result } = renderHook(() => useSaveFeatures(), { wrapper });

    await act(async () => {
      result.current.mutate(newFeatures);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // After error + settlement, cache should eventually revert via invalidation
    // The onError handler restores 'previous'
    await waitFor(() => {
      const cached = queryClient.getQueryData<Feature[]>(["features", "my-org"]);
      expect(cached?.[0].title).toBe("Old");
    });
  });
});

describe("useCreateConfigRepo", () => {
  it("invalidates 5 query keys on success", async () => {
    mockCreateConfigRepo.mockResolvedValue(undefined);

    const { wrapper, queryClient } = createQueryWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateConfigRepo(), { wrapper });

    await act(async () => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (c) => (c[0] as { queryKey: string[] }).queryKey[0],
    );
    expect(invalidatedKeys).toContain("configRepo");
    expect(invalidatedKeys).toContain("sprint");
    expect(invalidatedKeys).toContain("features");
    expect(invalidatedKeys).toContain("people");
    expect(invalidatedKeys).toContain("settings");
  });
});
