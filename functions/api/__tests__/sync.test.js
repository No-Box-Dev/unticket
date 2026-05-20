import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../lib/github-sync.js", () => ({
  syncInit: vi.fn(),
  syncRepo: vi.fn(),
  syncFeatures: vi.fn(),
}));
vi.mock("../../lib/inactive-repos.js", () => ({
  filterInactive: vi.fn(async (_db, _o, _l, list) => list),
}));

import { onRequestGet, onRequestPost } from "../sync.js";
import { syncInit, syncRepo, syncFeatures } from "../../lib/github-sync.js";
import { filterInactive } from "../../lib/inactive-repos.js";

function makeDb({ firstResult = null, allResult = [] } = {}) {
  const calls = { first: [], all: [], run: [] };
  return {
    prepare(sql) {
      return {
        _sql: sql,
        _binds: [],
        bind(...binds) { this._binds = binds; return this; },
        async first() { calls.first.push({ sql, binds: this._binds }); return firstResult; },
        async all() { calls.all.push({ sql, binds: this._binds }); return { results: allResult }; },
        async run() { calls.run.push({ sql, binds: this._binds }); return { meta: { changes: 1 } }; },
      };
    },
    _calls: calls,
  };
}

function makeCtx({ db, url = "http://x/api/sync", method = "POST", isAdmin = true }) {
  return {
    request: new Request(url, { method }),
    env: { DB: db },
    data: { orgId: 1, orgLogin: "acme", token: "tok", isAdmin },
  };
}

beforeEach(() => { syncInit.mockReset(); syncRepo.mockReset(); syncFeatures.mockReset(); });
afterEach(() => vi.restoreAllMocks());

describe("POST /api/sync — features scope", () => {
  it("runs syncFeatures and short-circuits", async () => {
    syncFeatures.mockResolvedValue();
    const res = await onRequestPost(makeCtx({ db: makeDb(), url: "http://x/api/sync?scope=features" }));
    expect(syncFeatures).toHaveBeenCalled();
    expect(syncInit).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ done: true, scope: "features" });
  });

  it("500s when syncFeatures throws", async () => {
    syncFeatures.mockRejectedValue(new Error("boom"));
    const res = await onRequestPost(makeCtx({ db: makeDb(), url: "http://x/api/sync?scope=features" }));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/sync — phase 1 (init)", () => {
  it("runs syncInit and returns the first repo as cursor", async () => {
    syncInit.mockResolvedValue(["api", "web"]);
    const db = makeDb();
    const res = await onRequestPost(makeCtx({ db }));
    expect(syncInit).toHaveBeenCalled();
    expect(await res.json()).toEqual({
      done: false,
      cursor: "api",
      repos: 2,
      repoList: ["api", "web"],
    });
  });

  it("returns done=true when there are no repos", async () => {
    syncInit.mockResolvedValue([]);
    const res = await onRequestPost(makeCtx({ db: makeDb() }));
    expect(await res.json()).toEqual({ done: true, repos: 0 });
  });

  it("rate-limits force=true on init when cooldown still active", async () => {
    const recentIso = new Date(Date.now() - 60 * 1000).toISOString();
    const db = makeDb({ firstResult: { last_synced: recentIso } });
    const res = await onRequestPost(makeCtx({ db, url: "http://x/api/sync?force=true" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("POST /api/sync — phase 2 (one-repo)", () => {
  it("syncs the cursor repo and returns the next repo", async () => {
    syncRepo.mockResolvedValue();
    const db = makeDb({ allResult: [{ name: "api" }, { name: "web" }] });
    const res = await onRequestPost(makeCtx({ db, url: "http://x/api/sync?cursor=api" }));
    expect(syncRepo).toHaveBeenCalledWith(expect.any(Object), "tok", 1, "acme", "api", false, expect.any(Object));
    expect(await res.json()).toEqual({ done: false, cursor: "web", synced: "api" });
  });

  it("returns done=true with lastRepo when no more repos remain", async () => {
    syncRepo.mockResolvedValue();
    const db = makeDb({ allResult: [{ name: "api" }] });
    const res = await onRequestPost(makeCtx({ db, url: "http://x/api/sync?cursor=api" }));
    expect(await res.json()).toEqual({ done: true, lastRepo: "api" });
  });

  it("500s when syncRepo throws", async () => {
    syncRepo.mockRejectedValue(new Error("bad"));
    const res = await onRequestPost(makeCtx({ db: makeDb({ allResult: [] }), url: "http://x/api/sync?cursor=api" }));
    expect(res.status).toBe(500);
  });
});

describe("GET /api/sync — staleness check", () => {
  it("returns isStale=true when no sync rows", async () => {
    const db = makeDb({ allResult: [], firstResult: { oldest: null } });
    const res = await onRequestGet(makeCtx({ db, method: "GET" }));
    const body = await res.json();
    expect(body.isStale).toBe(true);
    expect(body.lastSync).toBe(null);
  });

  it("returns isStale=false when oldest sync is fresh", async () => {
    const fresh = new Date(Date.now() - 60 * 1000).toISOString();
    const db = makeDb({
      allResult: [{ resource: "repos", last_synced: fresh, etag: "abc" }],
      firstResult: { oldest: fresh },
    });
    const res = await onRequestGet(makeCtx({ db, method: "GET" }));
    const body = await res.json();
    expect(body.isStale).toBe(false);
    expect(body.resources.repos).toEqual({ lastSynced: fresh, etag: "abc" });
  });
});
