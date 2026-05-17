import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/helpers";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(),
}));

import { apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBootstrapStatus } from "../useBootstrapStatus";

const mockGet = vi.mocked(apiGet);
const mockUseAuth = vi.mocked(useAuth);

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

describe("useBootstrapStatus", () => {
  it("does not run when no org is selected", async () => {
    mockUseAuth.mockReturnValue({ ...authValue, selectedOrg: null });
    const { wrapper } = createQueryWrapper();
    renderHook(() => useBootstrapStatus(), { wrapper });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("queries /api/bootstrap-status and returns bootstrapping flag", async () => {
    mockGet.mockResolvedValue({ bootstrapping: true });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBootstrapStatus(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith("/api/bootstrap-status");
    expect(result.current.data).toEqual({ bootstrapping: true });
  });

  it("invalidates all queries once bootstrapping flips to false", async () => {
    mockGet.mockResolvedValue({ bootstrapping: false });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useBootstrapStatus(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The effect runs synchronously after the data lands.
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });
});
