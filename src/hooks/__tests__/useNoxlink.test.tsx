import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createQueryWrapper } from "@/test/helpers";

vi.mock("@/lib/noxlink-api", () => ({
  fetchActors: vi.fn(),
  fetchActor: vi.fn(),
  patchActor: vi.fn(),
  fetchProjects: vi.fn(),
  fetchEvents: vi.fn(),
  fetchEventsPage: vi.fn(),
  fetchEvent: vi.fn(),
  backfillProjectPrs: vi.fn(),
  archiveProject: vi.fn(),
  unarchiveProject: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(),
}));

import {
  fetchActors,
  fetchActor,
  patchActor,
  fetchProjects,
  fetchEvents,
  fetchEventsPage,
  fetchEvent,
  backfillProjectPrs,
  archiveProject,
  unarchiveProject,
} from "@/lib/noxlink-api";
import { useAuth } from "@/lib/auth";
import {
  useFeedActors,
  useFeedActor,
  useFeedProjects,
  useFeedEvent,
  useFeedEvents,
  usePosts,
  useInfinitePosts,
  usePatchActor,
  useBackfillProjectPrs,
  useSetProjectArchived,
  POST_TRIGGER_TYPES,
} from "../useNoxlink";

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

describe("POST_TRIGGER_TYPES", () => {
  it("includes pr:merged (load-bearing — must match server NARRATABLE_TYPES)", () => {
    expect(POST_TRIGGER_TYPES).toContain("github:pr:merged");
  });
});

describe("useFeedActors", () => {
  it("does not run without an org", async () => {
    mockUseAuth.mockReturnValue({ ...authValue, selectedOrg: null });
    const { wrapper } = createQueryWrapper();
    renderHook(() => useFeedActors(), { wrapper });
    expect(fetchActors).not.toHaveBeenCalled();
  });

  it("calls fetchActors when org is set", async () => {
    vi.mocked(fetchActors).mockResolvedValue([{ id: "a1" } as any]);
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useFeedActors(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "a1" }]);
  });
});

describe("useFeedActor", () => {
  it("does not run when id is null", async () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => useFeedActor(null), { wrapper });
    expect(fetchActor).not.toHaveBeenCalled();
  });

  it("fetches the single actor when id is set", async () => {
    vi.mocked(fetchActor).mockResolvedValue({ id: "a1", name: "X" } as any);
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useFeedActor("a1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchActor).toHaveBeenCalledWith("a1");
  });
});

describe("useFeedProjects", () => {
  it("fetches the projects list", async () => {
    vi.mocked(fetchProjects).mockResolvedValue([{ id: "p1" } as any]);
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useFeedProjects(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });
});

describe("useFeedEvent", () => {
  it("does not run when id is null", async () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => useFeedEvent(null), { wrapper });
    expect(fetchEvent).not.toHaveBeenCalled();
  });

  it("does not run when enabled=false", async () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => useFeedEvent(42, false), { wrapper });
    expect(fetchEvent).not.toHaveBeenCalled();
  });

  it("fetches when id is set + enabled=true", async () => {
    vi.mocked(fetchEvent).mockResolvedValue({ id: 42 } as any);
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useFeedEvent(42), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchEvent).toHaveBeenCalledWith(42);
  });
});

describe("useFeedEvents", () => {
  it("passes the query object to fetchEvents", async () => {
    vi.mocked(fetchEvents).mockResolvedValue([]);
    const { wrapper } = createQueryWrapper();
    renderHook(() => useFeedEvents({ type: "narrative", limit: 10 }), { wrapper });
    await waitFor(() => expect(fetchEvents).toHaveBeenCalledWith({ type: "narrative", limit: 10 }));
  });

  it("can be disabled via opts.enabled=false", async () => {
    vi.mocked(fetchEvents).mockResolvedValue([]);
    const { wrapper } = createQueryWrapper();
    renderHook(() => useFeedEvents({}, { enabled: false }), { wrapper });
    expect(fetchEvents).not.toHaveBeenCalled();
  });
});

describe("usePosts", () => {
  it("fetches narratives filtered by POST_TRIGGER_TYPES", async () => {
    vi.mocked(fetchEvents).mockResolvedValue([]);
    const { wrapper } = createQueryWrapper();
    renderHook(() => usePosts(10), { wrapper });
    await waitFor(() => expect(fetchEvents).toHaveBeenCalledWith({
      type: "narrative",
      limit: 10,
      triggerTypes: POST_TRIGGER_TYPES,
    }));
  });
});

describe("useInfinitePosts", () => {
  it("fetches first page with no `before`", async () => {
    vi.mocked(fetchEventsPage).mockResolvedValue({ events: [], nextCursor: null });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useInfinitePosts({ pageSize: 5 }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const callArgs = vi.mocked(fetchEventsPage).mock.calls[0][0];
    expect(callArgs).toMatchObject({ type: "narrative", limit: 5, before: undefined });
  });

  it("stops paginating once page shorter than pageSize is returned", async () => {
    vi.mocked(fetchEventsPage).mockResolvedValue({ events: [], nextCursor: null });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useInfinitePosts({ pageSize: 5 }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });

  it("forwards actorId + projectId filters", async () => {
    vi.mocked(fetchEventsPage).mockResolvedValue({ events: [], nextCursor: null });
    const { wrapper } = createQueryWrapper();
    renderHook(() => useInfinitePosts({ actorId: "a1", projectId: "p1" }), { wrapper });
    await waitFor(() => expect(fetchEventsPage).toHaveBeenCalled());
    const args = vi.mocked(fetchEventsPage).mock.calls[0][0]!;
    expect(args.actorId).toBe("a1");
    expect(args.projectId).toBe("p1");
  });
});

describe("usePatchActor", () => {
  it("optimistically writes the updated actor into the per-actor cache", async () => {
    vi.mocked(patchActor).mockResolvedValue({ id: "a1", name: "Updated" } as any);
    const { wrapper, queryClient } = createQueryWrapper();
    const setData = vi.spyOn(queryClient, "setQueryData");
    const { result } = renderHook(() => usePatchActor(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "a1", fields: { name: "Updated" } });
    });
    expect(setData).toHaveBeenCalledWith(
      ["noxlink", "actor", "my-org", "a1"],
      expect.objectContaining({ id: "a1", name: "Updated" }),
    );
  });
});

describe("useBackfillProjectPrs", () => {
  it("calls backfillProjectPrs and invalidates events cache", async () => {
    vi.mocked(backfillProjectPrs).mockResolvedValue({ ok: true } as any);
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useBackfillProjectPrs(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "p1", days: 7 });
    });
    expect(backfillProjectPrs).toHaveBeenCalledWith("p1", 7);
    const keys = invalidate.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(["noxlink", "events", "my-org"]);
  });
});

describe("useSetProjectArchived", () => {
  it("routes to archiveProject when archived=true", async () => {
    vi.mocked(archiveProject).mockResolvedValue({ ok: true } as any);
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useSetProjectArchived(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "p1", archived: true });
    });
    expect(archiveProject).toHaveBeenCalledWith("p1");
    expect(unarchiveProject).not.toHaveBeenCalled();
  });

  it("routes to unarchiveProject when archived=false", async () => {
    vi.mocked(unarchiveProject).mockResolvedValue({ ok: true } as any);
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useSetProjectArchived(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "p1", archived: false });
    });
    expect(unarchiveProject).toHaveBeenCalledWith("p1");
  });
});
