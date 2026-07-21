import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

import { apiGet, apiPost, apiPatch, apiDelete } from "../api";
import {
  fetchFeaturesFromD1,
  createFeature,
  updateFeature,
  deleteFeature,
  withStatusTransition,
} from "../github-features";

const mockGet = vi.mocked(apiGet);
const mockPost = vi.mocked(apiPost);
const mockPatch = vi.mocked(apiPatch);
const mockDelete = vi.mocked(apiDelete);

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe("withStatusTransition", () => {
  const base = { id: 1, title: "x", status: "todo" as const, owners: [] };

  it("returns same feature when status matches", () => {
    const result = withStatusTransition({ ...base, statusHistory: [{ status: "todo", timestamp: "t" }] }, "todo");
    expect(result).toEqual({ ...base, statusHistory: [{ status: "todo", timestamp: "t" }] });
  });

  it("appends to statusHistory when status changes", () => {
    const result = withStatusTransition({ ...base, statusHistory: [{ status: "todo", timestamp: "t1" }] }, "staging");
    expect(result.status).toBe("staging");
    expect(result.statusHistory).toHaveLength(2);
    expect(result.statusHistory![1].status).toBe("staging");
  });

  it("creates statusHistory if missing", () => {
    const result = withStatusTransition(base, "ready");
    expect(result.statusHistory).toHaveLength(1);
    expect(result.statusHistory![0].status).toBe("ready");
  });
});

describe("fetchFeaturesFromD1", () => {
  it("filters out rows missing 'unticket' OR 'feature' labels", async () => {
    mockGet.mockResolvedValue([
      { number: 1, title: "ok", body: "", assignees: [], labels: [{ name: "unticket" }, { name: "feature" }], html_url: "u" },
      { number: 2, title: "no-unticket", body: "", assignees: [], labels: [{ name: "feature" }], html_url: "u" },
      { number: 3, title: "no-feature", body: "", assignees: [], labels: [{ name: "unticket" }], html_url: "u" },
    ]);
    const result = await fetchFeaturesFromD1();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("derives status='todo' from labels with no status: prefix", async () => {
    mockGet.mockResolvedValue([
      { number: 1, title: "x", body: "", assignees: [], labels: [{ name: "unticket" }, { name: "feature" }], html_url: "u" },
    ]);
    const result = await fetchFeaturesFromD1();
    expect(result[0].status).toBe("todo");
  });

  it("derives status from 'status:staging' label", async () => {
    mockGet.mockResolvedValue([
      {
        number: 1, title: "x", body: "", assignees: [], html_url: "u",
        labels: [{ name: "unticket" }, { name: "feature" }, { name: "status:staging" }],
      },
    ]);
    const result = await fetchFeaturesFromD1();
    expect(result[0].status).toBe("staging");
  });

  it("parses metadata block in body for statusHistory", async () => {
    // Feature bodies used to prefix a plan-text section before the metadata
    // block; that concept is retired — issueToFeature no longer surfaces
    // the body content on the wire. Metadata still comes through.
    const body = `Plan content here\n\n<!-- unticket:metadata\n${JSON.stringify({
      statusHistory: [{ status: "todo", timestamp: "2026-01-01T00:00:00Z" }],
    })}\n-->`;
    mockGet.mockResolvedValue([
      {
        number: 1, title: "x", body, assignees: [], html_url: "u",
        labels: [{ name: "unticket" }, { name: "feature" }],
      },
    ]);
    const result = await fetchFeaturesFromD1();
    expect(result[0].statusHistory).toEqual([{ status: "todo", timestamp: "2026-01-01T00:00:00Z" }]);
  });

  it("tolerates corrupt metadata block (treats as plain body)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = `Body\n\n<!-- unticket:metadata\nnot json\n-->`;
    mockGet.mockResolvedValue([
      {
        number: 1, title: "x", body, assignees: [], html_url: "u",
        labels: [{ name: "unticket" }, { name: "feature" }],
      },
    ]);
    await fetchFeaturesFromD1();
    // Corrupt metadata falls through as plain body — but Feature.plan no
    // longer exists on the wire, so just assert the warn fired.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("createFeature", () => {
  it("POSTs to /api/features with the requested fields", async () => {
    mockPost.mockResolvedValue({
      id: 5, title: "Add login", status: "todo", owners: [],
    });
    const result = await createFeature("org", "Add login", { status: "todo" });
    expect(mockPost).toHaveBeenCalledWith("/api/features", {
      title: "Add login", status: "todo", owners: [],
    });
    expect(result.id).toBe(5);
    expect(result.title).toBe("Add login");
  });

  it("forwards owners when provided (no plan field — retired)", async () => {
    mockPost.mockResolvedValue({ id: 5, title: "X", status: "staging", owners: ["alice"] });
    await createFeature("org", "X", { status: "staging", owners: ["alice"] });
    expect(mockPost).toHaveBeenCalledWith("/api/features", {
      title: "X", status: "staging", owners: ["alice"],
    });
  });

  it("propagates the error when the API helper rejects", async () => {
    mockPost.mockRejectedValue(new Error("title is required"));
    await expect(createFeature("org", "", { status: "todo" })).rejects.toThrow(/title is required/);
  });
});

describe("updateFeature", () => {
  it("PATCHes /api/features/:id with title, status, owners (no plan)", async () => {
    mockPatch.mockResolvedValue({
      id: 5, title: "X", status: "ready", owners: ["alice"],
    });
    const result = await updateFeature("org", {
      id: 5, title: "X", status: "ready", owners: ["alice"],
    });
    expect(mockPatch).toHaveBeenCalledWith("/api/features/5", {
      title: "X", status: "ready", owners: ["alice"], backlog: false,
      specLinks: [], linkedSpecIds: [],
    });
    expect(result.id).toBe(5);
  });

  it("always sends specLinks + linkedSpecIds so cleared lists patch through", async () => {
    mockPatch.mockResolvedValue({ id: 5, title: "X", status: "todo", owners: [] });
    await updateFeature("org", { id: 5, title: "X", status: "todo", owners: [] });
    expect(mockPatch).toHaveBeenCalledWith("/api/features/5", {
      title: "X", status: "todo", owners: [], backlog: false,
      specLinks: [], linkedSpecIds: [],
    });
  });

  it("propagates the error when the API helper rejects", async () => {
    mockPatch.mockRejectedValue(new Error("Feature not found"));
    await expect(updateFeature("org", { id: 99, title: "X", status: "todo", owners: [] }))
      .rejects.toThrow(/Feature not found/);
  });
});

describe("deleteFeature", () => {
  it("DELETEs /api/features/:id", async () => {
    mockDelete.mockResolvedValue({ ok: true });
    await deleteFeature("org", 5);
    expect(mockDelete).toHaveBeenCalledWith("/api/features/5");
  });

  it("propagates the error when the API helper rejects", async () => {
    mockDelete.mockRejectedValue(new Error("boom"));
    await expect(deleteFeature("org", 5)).rejects.toThrow(/boom/);
  });
});
