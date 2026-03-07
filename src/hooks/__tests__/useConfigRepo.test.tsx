import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createQueryWrapper } from "@/test/helpers";

vi.mock("@/lib/config-repo", () => ({
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
}));

vi.mock("@/lib/github-features", () => ({
  fetchFeatures: vi.fn(),
  createFeature: vi.fn(),
  updateFeature: vi.fn(),
  deleteFeature: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(),
}));

import { createConfigRepo as createConfigRepoFn } from "@/lib/config-repo";
import { updateFeature as ghUpdateFeature, deleteFeature as ghDeleteFeature } from "@/lib/github-features";
import { useAuth } from "@/lib/auth";
import { useUpdateFeature, useDeleteFeature, useCreateConfigRepo } from "../useConfigRepo";
import type { Feature } from "@/lib/types";

const mockUseAuth = vi.mocked(useAuth);
const mockUpdateFeature = vi.mocked(ghUpdateFeature);
const mockDeleteFeature = vi.mocked(ghDeleteFeature);
const mockCreateConfigRepo = vi.mocked(createConfigRepoFn);

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

describe("useUpdateFeature", () => {
  const feature: Feature = {
    id: 1, title: "Test", owners: [], status: "plan", sprint: 1, effort: "low",
  };
  const updated: Feature = { ...feature, title: "Updated", status: "demo" };

  it("optimistically updates cache", async () => {
    mockUpdateFeature.mockResolvedValue(updated);

    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(["features", "my-org"], [feature]);

    const { result } = renderHook(() => useUpdateFeature(), { wrapper });

    await act(async () => {
      result.current.mutate(updated);
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<Feature[]>(["features", "my-org"]);
      expect(cached?.[0].title).toBe("Updated");
    });
  });

  it("rolls back on error", async () => {
    mockUpdateFeature.mockRejectedValue(new Error("fail"));

    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(["features", "my-org"], [feature]);

    const { result } = renderHook(() => useUpdateFeature(), { wrapper });

    await act(async () => {
      result.current.mutate(updated);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    await waitFor(() => {
      const cached = queryClient.getQueryData<Feature[]>(["features", "my-org"]);
      expect(cached?.[0].title).toBe("Test");
    });
  });
});

describe("useDeleteFeature", () => {
  const feature: Feature = {
    id: 1, title: "Test", owners: [], status: "plan", sprint: 1, effort: "low",
  };

  it("optimistically removes from cache", async () => {
    mockDeleteFeature.mockResolvedValue(undefined);

    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(["features", "my-org"], [feature]);

    const { result } = renderHook(() => useDeleteFeature(), { wrapper });

    await act(async () => {
      result.current.mutate(1);
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<Feature[]>(["features", "my-org"]);
      expect(cached).toEqual([]);
    });
  });

});

describe("useCreateConfigRepo", () => {
  it("invalidates query keys on success", async () => {
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
