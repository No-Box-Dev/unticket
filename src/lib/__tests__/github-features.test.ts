import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Build a shared Octokit mock that every test can configure.
const mockOctokit = {
  rest: {
    issues: {
      listLabelsForRepo: vi.fn(),
      createLabel: vi.fn(),
      listForRepo: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      get: vi.fn(),
    },
  },
  paginate: vi.fn(),
};

vi.mock("../github", () => ({
  getOctokit: () => mockOctokit,
}));

vi.mock("../api", () => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
  apiFetch: vi.fn(),
}));

vi.mock("../unticket-repo-name", () => ({
  getUnticketRepoName: () => "unticket",
}));

import { apiGet, apiPut, apiFetch } from "../api";
import {
  fetchFeaturesFromD1,
  fetchFeatures,
  ensureFeatureLabels,
  createFeature,
  updateFeature,
  deleteFeature,
  withStatusTransition,
} from "../github-features";

const mockGet = vi.mocked(apiGet);
const mockPut = vi.mocked(apiPut);
const mockFetch = vi.mocked(apiFetch);

beforeEach(() => {
  // resetAllMocks clears implementations too — clearAllMocks only nukes call history.
  // Implementation leaks were causing "Error: nope" from the 422 test to bleed
  // into later tests.
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

describe("ensureFeatureLabels", () => {
  beforeEach(() => {
    // Reset the per-test module state cache. Easiest: dynamic re-import.
    vi.resetModules();
  });

  it("creates missing labels and skips existing ones", async () => {
    mockOctokit.rest.issues.listLabelsForRepo.mockResolvedValue({
      data: [{ name: "unticket" }, { name: "feature" }],
    });
    mockOctokit.rest.issues.createLabel.mockResolvedValue({});
    // Use the imported reference (not re-imported, since state lives in same module)
    await ensureFeatureLabels("my-new-org");
    // 2 existing + 4 missing status:* labels = 4 createLabel calls
    expect(mockOctokit.rest.issues.createLabel).toHaveBeenCalledTimes(4);
  });

  it("survives 422 errors (label already exists race)", async () => {
    mockOctokit.rest.issues.listLabelsForRepo.mockResolvedValue({ data: [] });
    mockOctokit.rest.issues.createLabel.mockRejectedValue(
      Object.assign(new Error("Validation Failed"), { status: 422 }),
    );
    // Should not throw despite every createLabel failing with 422.
    await expect(ensureFeatureLabels("org-422")).resolves.not.toThrow();
  });

  it("rethrows non-422 errors", async () => {
    mockOctokit.rest.issues.listLabelsForRepo.mockResolvedValue({ data: [] });
    mockOctokit.rest.issues.createLabel.mockRejectedValue(
      Object.assign(new Error("nope"), { status: 500 }),
    );
    await expect(ensureFeatureLabels("org-err")).rejects.toThrow("nope");
  });
});

describe("fetchFeatures", () => {
  // Unique org per test: ensureFeatureLabels caches "already done" orgs in a
  // module-level Set that we can't easily reset between tests. Using a new
  // org name each time forces the ensure path to run cleanly.
  it("requests issues with BOTH unticket+feature labels", async () => {
    mockOctokit.rest.issues.listLabelsForRepo.mockResolvedValue({
      data: [{ name: "unticket" }, { name: "feature" }, { name: "status:staging" },
             { name: "status:ready" }, { name: "status:production" }, { name: "status:future" }],
    });
    mockOctokit.paginate.mockResolvedValue([]);
    await fetchFeatures("fetch-org-1");
    const [, opts] = mockOctokit.paginate.mock.calls[0];
    expect(opts.labels).toBe("unticket,feature");
    expect(opts.owner).toBe("fetch-org-1");
    expect(opts.state).toBe("open");
  });

  it("filters out PRs (pull_request property present)", async () => {
    mockOctokit.rest.issues.listLabelsForRepo.mockResolvedValue({
      data: [{ name: "unticket" }, { name: "feature" }, { name: "status:staging" },
             { name: "status:ready" }, { name: "status:production" }, { name: "status:future" }],
    });
    mockOctokit.paginate.mockResolvedValue([
      { number: 1, title: "feature", body: "", labels: [], assignees: [], pull_request: undefined },
      { number: 2, title: "actually a PR", body: "", labels: [], assignees: [], pull_request: {} },
    ]);
    const result = await fetchFeatures("fetch-org-2");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });
});

describe("createFeature", () => {
  it("includes a fresh statusHistory in the metadata block", async () => {
    mockOctokit.rest.issues.create.mockResolvedValue({
      data: { number: 5, title: "x", body: "", labels: [], assignees: [], html_url: "u" },
    });
    mockPut.mockResolvedValue({ ok: true });
    await createFeature("org", "Add login", { status: "todo", plan: "Build it" });
    const [args] = mockOctokit.rest.issues.create.mock.calls[0];
    expect(args.title).toBe("Add login");
    expect(args.labels).toEqual(["unticket", "feature"]);  // todo → no status: label
    expect(args.body).toContain("Build it");
    expect(args.body).toContain("unticket:metadata");
  });

  it("emits 'status:staging' label when status=staging", async () => {
    mockOctokit.rest.issues.create.mockResolvedValue({
      data: { number: 5, title: "x", body: "", labels: [], assignees: [], html_url: "u" },
    });
    mockPut.mockResolvedValue({ ok: true });
    await createFeature("org", "X", { status: "staging" });
    const [args] = mockOctokit.rest.issues.create.mock.calls[0];
    expect(args.labels).toEqual(["unticket", "feature", "status:staging"]);
  });

  it("does NOT pass assignees when owners is empty", async () => {
    mockOctokit.rest.issues.create.mockResolvedValue({
      data: { number: 5, title: "x", body: "", labels: [], assignees: [], html_url: "u" },
    });
    mockPut.mockResolvedValue({ ok: true });
    await createFeature("org", "X", { status: "todo" });
    const [args] = mockOctokit.rest.issues.create.mock.calls[0];
    expect(args.assignees).toBeUndefined();
  });

  it("syncs the created issue to D1 via PUT /api/features", async () => {
    mockOctokit.rest.issues.create.mockResolvedValue({
      data: { number: 5, title: "x", body: "", labels: [], assignees: [], html_url: "u", state: "open", created_at: "t", updated_at: "t" },
    });
    mockPut.mockResolvedValue({ ok: true });
    await createFeature("org", "X", { status: "todo" });
    expect(mockPut).toHaveBeenCalledWith("/api/features", expect.objectContaining({
      number: 5,
      title: "x",
    }));
  });
});

describe("updateFeature", () => {
  it("rebuilds labels from new status + persists linkedPRs in body", async () => {
    mockOctokit.rest.issues.update.mockResolvedValue({
      data: { number: 5, title: "x", body: "", labels: [], assignees: [], html_url: "u" },
    });
    mockPut.mockResolvedValue({ ok: true });
    await updateFeature("org", {
      id: 5,
      title: "X",
      status: "ready",
      owners: ["alice"],
      plan: "do it",
      linkedPRs: [{ repo: "api", number: 100 }],
    });
    const [args] = mockOctokit.rest.issues.update.mock.calls[0];
    expect(args.labels).toEqual(["unticket", "feature", "status:ready"]);
    expect(args.assignees).toEqual(["alice"]);
    expect(args.body).toContain("do it");
    expect(args.body).toContain('"linkedPRs"');
  });
});

describe("deleteFeature", () => {
  it("closes the issue, strips unticket+feature+status labels, and deletes from D1", async () => {
    mockOctokit.rest.issues.get.mockResolvedValue({
      data: { labels: [{ name: "unticket" }, { name: "feature" }, { name: "status:ready" }, { name: "bug" }] },
    });
    mockOctokit.rest.issues.update.mockResolvedValue({});
    mockFetch.mockResolvedValue({ ok: true } as Response);
    await deleteFeature("org", 5);
    const [args] = mockOctokit.rest.issues.update.mock.calls[0];
    expect(args.state).toBe("closed");
    expect(args.labels).toEqual(["bug"]);  // unticket/feature/status:* stripped
    expect(mockFetch).toHaveBeenCalledWith("/api/features?number=5", { method: "DELETE" });
  });

  it("throws when the D1 delete fails", async () => {
    mockOctokit.rest.issues.get.mockResolvedValue({ data: { labels: [] } });
    mockOctokit.rest.issues.update.mockResolvedValue({});
    mockFetch.mockResolvedValue({
      ok: false,
      statusText: "Server Error",
      json: async () => ({ error: "boom" }),
    } as Response);
    await expect(deleteFeature("org", 5)).rejects.toThrow(/boom/);
  });
});
