import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../lib/inactive-repos.js", () => ({
  getInactiveRepoSet: vi.fn(),
}));
vi.mock("../../lib/feature-matcher.js", () => ({
  matchPRToFeatures: vi.fn(),
}));

import { onRequestPost } from "../features/backfill-matches.js";
import { getInactiveRepoSet } from "../../lib/inactive-repos.js";
import { matchPRToFeatures } from "../../lib/feature-matcher.js";

function makeDb({ allByFragment = {} } = {}) {
  const calls = { all: [], run: [], batch: [] };
  function prepare(sql) {
    return {
      _sql: sql,
      _binds: [],
      bind(...binds) { this._binds = binds; return this; },
      async all() {
        calls.all.push({ sql, binds: this._binds });
        for (const [frag, results] of Object.entries(allByFragment)) {
          if (sql.includes(frag)) return { results };
        }
        return { results: [] };
      },
      async run() { calls.run.push({ sql, binds: this._binds }); return { meta: { changes: 0 } }; },
    };
  }
  return {
    prepare,
    async batch(stmts) {
      calls.batch.push(stmts.map((s) => ({ sql: s._sql, binds: s._binds })));
      return stmts.map(() => ({ meta: { changes: 0 } }));
    },
    _calls: calls,
  };
}

function makeCtx({ db, body = {}, env = {}, waitUntil = vi.fn() }) {
  const req = new Request("http://x/api/features/backfill-matches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    request: req,
    env: { DB: db, ZHIPU_API_KEY: "k", ...env },
    data: { orgId: 1, orgLogin: "acme", token: "tok" },
    waitUntil,
  };
}

beforeEach(() => {
  global.fetch = vi.fn();
  getInactiveRepoSet.mockReset();
  matchPRToFeatures.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/features/backfill-matches", () => {
  it("503s when ZHIPU_API_KEY is missing", async () => {
    const res = await onRequestPost(makeCtx({ db: makeDb(), env: { ZHIPU_API_KEY: undefined } }));
    expect(res.status).toBe(503);
  });

  it("returns zero counts when there are no active repos", async () => {
    getInactiveRepoSet.mockResolvedValue(new Set());
    const db = makeDb({ allByFragment: { "FROM repos": [] } });
    const res = await onRequestPost(makeCtx({ db }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      scanned: 0,
      queued: 0,
      repos: 0,
      reposInTable: 0,
    });
  });

  it("skips inactive repos when filtering active set", async () => {
    getInactiveRepoSet.mockResolvedValue(new Set(["drafty"]));
    const db = makeDb({ allByFragment: { "FROM repos": [{ name: "api" }, { name: "drafty" }] } });
    global.fetch.mockResolvedValue({ ok: true, json: async () => [] });
    const res = await onRequestPost(makeCtx({ db }));
    const body = await res.json();
    expect(body.reposInTable).toBe(2);
    expect(body.repos).toBe(1);
    // Only one repo means one fetch
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain("/acme/api/pulls");
  });

  it("records errors per repo when GitHub fetch fails", async () => {
    getInactiveRepoSet.mockResolvedValue(new Set());
    const db = makeDb({ allByFragment: { "FROM repos": [{ name: "api" }] } });
    global.fetch.mockResolvedValue({ ok: false, status: 502, statusText: "Bad Gateway", json: async () => ({}) });
    const res = await onRequestPost(makeCtx({ db }));
    const body = await res.json();
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatch(/api:.*502/);
  });

  it("queues unlinked PRs and schedules matchPRToFeatures via waitUntil", async () => {
    getInactiveRepoSet.mockResolvedValue(new Set());
    const db = makeDb({
      allByFragment: {
        "FROM repos": [{ name: "api" }],
        // No existing links — all PRs are candidates
        "pr_feature_links": [],
      },
    });
    const recentIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { number: 100, created_at: recentIso, body: "X", head: { ref: "fix-bug" } },
        { number: 101, created_at: recentIso, body: "X", head: { ref: "y" } },
      ],
    });
    const waitUntil = vi.fn((p) => p);
    const res = await onRequestPost(makeCtx({ db, waitUntil }));
    const body = await res.json();
    expect(body.scanned).toBe(2);
    expect(body.queued).toBe(2);
    expect(waitUntil).toHaveBeenCalled();
    // Await the scheduled promise so matchPRToFeatures runs
    await waitUntil.mock.calls[0][0];
    expect(matchPRToFeatures).toHaveBeenCalledTimes(2);
  });

  it("clamps days to [1, 30]", async () => {
    getInactiveRepoSet.mockResolvedValue(new Set());
    const db = makeDb({ allByFragment: { "FROM repos": [] } });
    const res1 = await onRequestPost(makeCtx({ db, body: { days: -5 } }));
    expect((await res1.json()).days).toBe(1);

    const res2 = await onRequestPost(makeCtx({ db, body: { days: 9999 } }));
    expect((await res2.json()).days).toBe(30);
  });

  it("with force=true, deletes pr_match_attempts before queuing", async () => {
    getInactiveRepoSet.mockResolvedValue(new Set());
    const db = makeDb({
      allByFragment: { "FROM repos": [{ name: "api" }] },
    });
    const recentIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => [{ number: 100, created_at: recentIso, head: { ref: "x" } }],
    });
    const res = await onRequestPost(makeCtx({ db, body: { force: true } }));
    expect((await res.json()).force).toBe(true);
    // batch[] should include a DELETE FROM pr_match_attempts
    const flat = db._calls.batch.flat();
    expect(flat.some((s) => s.sql.includes("DELETE FROM pr_match_attempts"))).toBe(true);
  });
});
