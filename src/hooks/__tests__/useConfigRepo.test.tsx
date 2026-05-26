import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createQueryWrapper } from "@/test/helpers";

vi.mock("@/lib/config-repo", () => ({
  createConfigRepo: vi.fn(),
  fetchPeople: vi.fn(),
  savePeople: vi.fn(),
  fetchSettings: vi.fn(),
  saveSettings: vi.fn(),
  ensureConfigRepo: vi.fn(),
}));

vi.mock("@/lib/github-features", () => ({
  fetchFeaturesFromD1: vi.fn(),
  createFeature: vi.fn(),
  updateFeature: vi.fn(),
  deleteFeature: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(),
}));

import { createConfigRepo as createConfigRepoFn } from "@/lib/config-repo";
import {
  createFeature as ghCreateFeature,
  updateFeature as ghUpdateFeature,
  deleteFeature as ghDeleteFeature,
} from "@/lib/github-features";
import { useAuth } from "@/lib/auth";
import {
  useCreateFeature,
  useUpdateFeature,
  useDeleteFeature,
  useCreateConfigRepo,
} from "../useConfigRepo";
import type { Feature } from "@/lib/types";

const mockUseAuth = vi.mocked(useAuth);
const mockCreateFeature = vi.mocked(ghCreateFeature);
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

describe("useCreateFeature", () => {
  it("shows a pending card immediately, then reconciles to the server feature", async () => {
    const created: Feature = {
      id: 42, title: "New feature", owners: [], status: "todo",
    };
    // Hold the create open so we can observe the optimistic pending card first.
    let resolveCreate: (f: Feature) => void = () => {};
    mockCreateFeature.mockReturnValue(
      new Promise<Feature>((resolve) => { resolveCreate = resolve; }),
    );

    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(["features", "my-org"], []);

    const { result } = renderHook(() => useCreateFeature(), { wrapper });

    act(() => {
      result.current.mutate({ title: "New feature", status: "todo" });
    });

    // Optimistic: a pending card with a temporary negative id appears at once.
    await waitFor(() => {
      const cached = queryClient.getQueryData<Feature[]>(["features", "my-org"]);
      expect(cached).toHaveLength(1);
      expect(cached?.[0].pending).toBe(true);
      expect(cached?.[0].id).toBeLessThan(0);
      expect(cached?.[0].title).toBe("New feature");
    });

    await act(async () => {
      resolveCreate(created);
    });

    // The temp card is swapped for the real feature once GitHub assigns a number.
    await waitFor(() => {
      const cached = queryClient.getQueryData<Feature[]>(["features", "my-org"]);
      expect(cached).toHaveLength(1);
      expect(cached?.[0].id).toBe(42);
      expect(cached?.[0].pending).toBeUndefined();
    });
  });

  it("rolls back the pending card on error", async () => {
    mockCreateFeature.mockRejectedValue(new Error("fail"));

    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(["features", "my-org"], []);

    const { result } = renderHook(() => useCreateFeature(), { wrapper });

    await act(async () => {
      result.current.mutate({ title: "New feature", status: "todo" });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    await waitFor(() => {
      const cached = queryClient.getQueryData<Feature[]>(["features", "my-org"]);
      expect(cached).toEqual([]);
    });
  });
});

describe("useUpdateFeature", () => {
  const feature: Feature = {
    id: 1, title: "Test", owners: [], status: "todo",
  };
  const updated: Feature = { ...feature, title: "Updated", status: "staging" };

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
    id: 1, title: "Test", owners: [], status: "todo",
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
    expect(invalidatedKeys).toContain("features");
    expect(invalidatedKeys).toContain("people");
    expect(invalidatedKeys).toContain("settings");
  });
});
