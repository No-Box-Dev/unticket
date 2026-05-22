import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

import { apiGet, apiPost, apiPatch, apiDelete } from "../api";
import {
  fetchActors,
  fetchActor,
  patchActor,
  fetchProjects,
  backfillProjectPrs,
  archiveProject,
  unarchiveProject,
  fetchEvent,
  fetchEvents,
  fetchEventsPage,
} from "../noxlink-api";

const mockGet = vi.mocked(apiGet);
const mockPost = vi.mocked(apiPost);
const mockPatch = vi.mocked(apiPatch);
const mockDelete = vi.mocked(apiDelete);

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPatch.mockReset();
  mockDelete.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("fetchActors", () => {
  it("returns the actors array from the wrapper response", async () => {
    mockGet.mockResolvedValue({ actors: [{ id: "a1" }, { id: "a2" }] });
    await expect(fetchActors()).resolves.toEqual([{ id: "a1" }, { id: "a2" }]);
    expect(mockGet).toHaveBeenCalledWith("/api/actors");
  });
});

describe("fetchActor", () => {
  it("encodes the id in the URL", async () => {
    mockGet.mockResolvedValue({ actor: { id: "actor_x" } });
    await fetchActor("actor with space");
    expect(mockGet).toHaveBeenCalledWith("/api/actors/actor%20with%20space");
  });

  it("returns the unwrapped actor", async () => {
    mockGet.mockResolvedValue({ actor: { id: "a1", name: "X" } });
    await expect(fetchActor("a1")).resolves.toEqual({ id: "a1", name: "X" });
  });
});

describe("patchActor", () => {
  it("PATCHes the encoded URL with the fields", async () => {
    mockPatch.mockResolvedValue({ actor: { id: "a1", name: "New" } });
    const result = await patchActor("a1", { name: "New", tone: "T" });
    expect(mockPatch).toHaveBeenCalledWith("/api/actors/a1", { name: "New", tone: "T" });
    expect(result).toEqual({ id: "a1", name: "New" });
  });
});

describe("fetchProjects", () => {
  it("returns the projects array", async () => {
    mockGet.mockResolvedValue({ projects: [{ id: "p1" }] });
    await expect(fetchProjects()).resolves.toEqual([{ id: "p1" }]);
    expect(mockGet).toHaveBeenCalledWith("/api/projects");
  });
});

describe("backfillProjectPrs", () => {
  it("POSTs with default days=3 and rewriteOtherModels=false", async () => {
    mockPost.mockResolvedValue({});
    await backfillProjectPrs("proj-1");
    expect(mockPost).toHaveBeenCalledWith(
      "/api/projects/proj-1/backfill-prs",
      { days: 3, rewriteOtherModels: false },
    );
  });

  it("respects an explicit days value", async () => {
    mockPost.mockResolvedValue({});
    await backfillProjectPrs("proj-1", 14);
    expect(mockPost).toHaveBeenCalledWith(
      "/api/projects/proj-1/backfill-prs",
      { days: 14, rewriteOtherModels: false },
    );
  });

  it("forwards rewriteOtherModels=true when requested", async () => {
    mockPost.mockResolvedValue({});
    await backfillProjectPrs("proj-1", 7, true);
    expect(mockPost).toHaveBeenCalledWith(
      "/api/projects/proj-1/backfill-prs",
      { days: 7, rewriteOtherModels: true },
    );
  });

  it("encodes special characters in the project id", async () => {
    mockPost.mockResolvedValue({});
    await backfillProjectPrs("proj/1");
    expect(mockPost.mock.calls[0][0]).toContain("proj%2F1");
  });
});

describe("archiveProject / unarchiveProject", () => {
  it("archiveProject POSTs an empty body", async () => {
    mockPost.mockResolvedValue({ ok: true });
    await archiveProject("p1");
    expect(mockPost).toHaveBeenCalledWith("/api/projects/p1/archive", {});
  });

  it("unarchiveProject DELETEs the archive endpoint", async () => {
    mockDelete.mockResolvedValue({ ok: true });
    await unarchiveProject("p1");
    expect(mockDelete).toHaveBeenCalledWith("/api/projects/p1/archive");
  });
});

describe("fetchEvent", () => {
  it("returns the unwrapped event", async () => {
    mockGet.mockResolvedValue({ event: { id: 42, type: "narrative" } });
    await expect(fetchEvent(42)).resolves.toEqual({ id: 42, type: "narrative" });
    expect(mockGet).toHaveBeenCalledWith("/api/events/42");
  });
});

describe("fetchEvents URL builder", () => {
  it("hits /api/events with no query string when no filters", async () => {
    mockGet.mockResolvedValue({ events: [], nextCursor: null });
    await fetchEvents();
    expect(mockGet).toHaveBeenCalledWith("/api/events");
  });

  it("encodes type, limit, before, project_id, actor_id, trigger_types", async () => {
    mockGet.mockResolvedValue({ events: [], nextCursor: null });
    await fetchEvents({
      type: "narrative",
      limit: 20,
      before: "2026-05-01",
      projectId: "p1",
      actorId: "a1",
      triggerTypes: ["github:pr:merged", "github:push"],
    });
    const [url] = mockGet.mock.calls[0];
    expect(url).toContain("type=narrative");
    expect(url).toContain("limit=20");
    expect(url).toContain("before=2026-05-01");
    expect(url).toContain("project_id=p1");
    expect(url).toContain("actor_id=a1");
    expect(url).toContain("trigger_types=github%3Apr%3Amerged%2Cgithub%3Apush");
  });

  it("omits empty trigger_types array", async () => {
    mockGet.mockResolvedValue({ events: [], nextCursor: null });
    await fetchEvents({ triggerTypes: [] });
    const [url] = mockGet.mock.calls[0];
    expect(url).not.toContain("trigger_types");
  });

  it("fetchEvents returns just the events array", async () => {
    mockGet.mockResolvedValue({ events: [{ id: 1 }], nextCursor: null });
    await expect(fetchEvents()).resolves.toEqual([{ id: 1 }]);
  });

  it("fetchEventsPage returns the full page (with nextCursor)", async () => {
    mockGet.mockResolvedValue({ events: [{ id: 1 }], nextCursor: "abc" });
    await expect(fetchEventsPage()).resolves.toEqual({ events: [{ id: 1 }], nextCursor: "abc" });
  });
});
