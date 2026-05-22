import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api", () => ({
  apiGet: vi.fn(),
  apiFetch: vi.fn(),
}));

import { apiGet, apiFetch } from "../api";
import {
  fetchFeaturesFromD1,
  createFeature,
  updateFeature,
  deleteFeature,
  withStatusTransition,
} from "../github-features";

const mockGet = vi.mocked(apiGet);
const mockFetch = vi.mocked(apiFetch);

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => vi.restoreAllMocks());

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  } as unknown as Response;
}

function errResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    statusText: "Error",
    json: async () => body,
  } as unknown as Response;
}

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

  it("hydrates linkedPRs from the row (server is authoritative)", async () => {
    mockGet.mockResolvedValue([
      {
        number: 1, title: "x", body: "", assignees: [], html_url: "u",
        labels: [{ name: "unticket" }, { name: "feature" }],
        linkedPRs: [{ repo: "api", number: 100 }],
      },
    ]);
    const result = await fetchFeaturesFromD1();
    expect(result[0].linkedPRs).toEqual([{ repo: "api", number: 100 }]);
  });

  it("parses metadata block in body for statusHistory", async () => {
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
    // parseMetadata only consumes ONE of the two leading newlines (regex is
    // `\n?<!-- ...`) — the remaining newline stays in the plan content. This
    // is also documented in the feature-metadata tests.
    expect(result[0].plan).toBe("Plan content here\n");
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
    const result = await fetchFeaturesFromD1();
    expect(result[0].plan).toBe(body);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("createFeature", () => {
  it("POSTs to /api/features with the requested fields", async () => {
    mockFetch.mockResolvedValue(okResponse({
      id: 5, title: "Add login", status: "todo", owners: [], plan: "Build it",
    }));
    const result = await createFeature("org", "Add login", { status: "todo", plan: "Build it" });
    expect(mockFetch).toHaveBeenCalledWith("/api/features", {
      method: "POST",
      body: JSON.stringify({ title: "Add login", status: "todo", owners: [], plan: "Build it" }),
    });
    expect(result.id).toBe(5);
    expect(result.title).toBe("Add login");
  });

  it("forwards owners when provided", async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 5, title: "X", status: "staging", owners: ["alice"] }));
    await createFeature("org", "X", { status: "staging", owners: ["alice"] });
    const [, init] = mockFetch.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      title: "X", status: "staging", owners: ["alice"], plan: "",
    });
  });

  it("throws with the server error message on non-OK responses", async () => {
    mockFetch.mockResolvedValue(errResponse(422, { error: "title is required" }));
    await expect(createFeature("org", "", { status: "todo" })).rejects.toThrow(/title is required/);
  });
});

describe("updateFeature", () => {
  it("PATCHes /api/features/:id with title, status, owners, plan", async () => {
    mockFetch.mockResolvedValue(okResponse({
      id: 5, title: "X", status: "ready", owners: ["alice"], plan: "do it",
      linkedPRs: [{ repo: "api", number: 100 }],
    }));
    const result = await updateFeature("org", {
      id: 5, title: "X", status: "ready", owners: ["alice"],
      plan: "do it", linkedPRs: [{ repo: "api", number: 100 }],
    });
    expect(mockFetch).toHaveBeenCalledWith("/api/features/5", {
      method: "PATCH",
      body: JSON.stringify({ title: "X", status: "ready", owners: ["alice"], plan: "do it" }),
    });
    expect(result.linkedPRs).toEqual([{ repo: "api", number: 100 }]);
  });

  it("sends an empty string plan when feature.plan is undefined", async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 5, title: "X", status: "todo", owners: [] }));
    await updateFeature("org", { id: 5, title: "X", status: "todo", owners: [] });
    const [, init] = mockFetch.mock.calls[0];
    expect(JSON.parse(init?.body as string).plan).toBe("");
  });

  it("throws with the server error message on non-OK responses", async () => {
    mockFetch.mockResolvedValue(errResponse(404, { error: "Feature not found" }));
    await expect(updateFeature("org", { id: 99, title: "X", status: "todo", owners: [] }))
      .rejects.toThrow(/Feature not found/);
  });
});

describe("deleteFeature", () => {
  it("DELETEs /api/features/:id", async () => {
    mockFetch.mockResolvedValue(okResponse({ ok: true }));
    await deleteFeature("org", 5);
    expect(mockFetch).toHaveBeenCalledWith("/api/features/5", { method: "DELETE" });
  });

  it("throws with the server error message on non-OK responses", async () => {
    mockFetch.mockResolvedValue(errResponse(500, { error: "boom" }));
    await expect(deleteFeature("org", 5)).rejects.toThrow(/boom/);
  });
});
