import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../lib/inactive-repos.js", () => ({
  getActiveRepoNames: vi.fn(),
}));
vi.mock("../../lib/event-reconcile.js", () => ({
  reconcileRepoEvents: vi.fn(),
}));

import { onRequestPost } from "../sync-events.js";
import { getActiveRepoNames } from "../../lib/inactive-repos.js";
import { reconcileRepoEvents } from "../../lib/event-reconcile.js";

// Minimal D1 stub. The no-cursor path reads the backfill-cooldown row
// (.first()) and writes it (.run()); `lastBackfill` controls the read.
function makeDb({ lastBackfill = null } = {}) {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => lastBackfill,
        run: async () => ({}),
      }),
    }),
  };
}

function makeCtx({ url = "http://x/api/sync-events", isAdmin = true, orgLogin = "acme", lastBackfill = null } = {}) {
  return {
    request: new Request(url, { method: "POST" }),
    env: { DB: makeDb({ lastBackfill }) },
    data: { orgId: 1, orgLogin, token: "tok", isAdmin },
  };
}

beforeEach(() => {
  getActiveRepoNames.mockReset();
  reconcileRepoEvents.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/sync-events — admin gate", () => {
  it("403s when caller is not admin", async () => {
    const res = await onRequestPost(makeCtx({ isAdmin: false }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Admin/i);
    expect(getActiveRepoNames).not.toHaveBeenCalled();
  });

  it("400s when orgLogin is missing", async () => {
    const res = await onRequestPost(makeCtx({ orgLogin: null }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/sync-events — phase 1 (no cursor)", () => {
  it("returns the first repo + full repoList", async () => {
    getActiveRepoNames.mockResolvedValueOnce(["api", "web"]);
    const res = await onRequestPost(makeCtx());
    const body = await res.json();
    expect(body).toEqual({
      done: false,
      cursor: "api",
      repos: 2,
      repoList: ["api", "web"],
    });
    expect(reconcileRepoEvents).not.toHaveBeenCalled();
  });

  it("returns done=true when no active repos", async () => {
    getActiveRepoNames.mockResolvedValueOnce([]);
    const res = await onRequestPost(makeCtx());
    expect(await res.json()).toEqual({ done: true, repos: 0 });
  });

  it("429s when a backfill ran within the last 24h", async () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    const res = await onRequestPost(makeCtx({ lastBackfill: { last_synced: recent } }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(getActiveRepoNames).not.toHaveBeenCalled();
  });

  it("allows a new backfill once the cooldown has elapsed", async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    getActiveRepoNames.mockResolvedValueOnce(["api"]);
    const res = await onRequestPost(makeCtx({ lastBackfill: { last_synced: old } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.cursor).toBe("api");
  });
});

describe("POST /api/sync-events — phase 2 (cursor)", () => {
  it("reconciles the cursor repo and returns the next one", async () => {
    getActiveRepoNames.mockResolvedValueOnce(["api", "web", "infra"]);
    reconcileRepoEvents.mockResolvedValueOnce({
      prOpened: 1, prClosed: 0, prMerged: 0,
      issueOpened: 0, issueClosed: 0,
      review: 0, push: 0, release: 0,
    });
    const res = await onRequestPost(
      makeCtx({ url: "http://x/api/sync-events?cursor=api" }),
    );
    const body = await res.json();
    expect(reconcileRepoEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        orgId: 1,
        orgLogin: "acme",
        repo: "api",
        token: "tok",
      }),
    );
    expect(body.done).toBe(false);
    expect(body.cursor).toBe("web");
    expect(body.synced).toBe("api");
  });

  it("returns done=true on the last repo", async () => {
    getActiveRepoNames.mockResolvedValueOnce(["api", "web"]);
    reconcileRepoEvents.mockResolvedValueOnce({
      prOpened: 0, prClosed: 0, prMerged: 0,
      issueOpened: 0, issueClosed: 0,
      review: 0, push: 0, release: 0,
    });
    const res = await onRequestPost(
      makeCtx({ url: "http://x/api/sync-events?cursor=web" }),
    );
    const body = await res.json();
    expect(body.done).toBe(true);
    expect(body.lastRepo).toBe("web");
  });

  it("uses a 30-day lookback (wider than the cron's 48h)", async () => {
    getActiveRepoNames.mockResolvedValueOnce(["api"]);
    reconcileRepoEvents.mockResolvedValueOnce({
      prOpened: 0, prClosed: 0, prMerged: 0,
      issueOpened: 0, issueClosed: 0,
      review: 0, push: 0, release: 0,
    });
    await onRequestPost(makeCtx({ url: "http://x/api/sync-events?cursor=api" }));
    const callArgs = reconcileRepoEvents.mock.calls[0][2];
    expect(callArgs.lookbackHours).toBe(24 * 30);
  });

  it("500s when reconcileRepoEvents throws", async () => {
    getActiveRepoNames.mockResolvedValueOnce(["api"]);
    reconcileRepoEvents.mockRejectedValueOnce(new Error("boom"));
    const res = await onRequestPost(
      makeCtx({ url: "http://x/api/sync-events?cursor=api" }),
    );
    expect(res.status).toBe(500);
  });
});
