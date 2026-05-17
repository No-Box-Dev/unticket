import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/inactive-repos.js", () => ({
  getActiveRepoNames: vi.fn(),
}));

import { onRequestGet } from "../prs.js";
import { getActiveRepoNames } from "../../lib/inactive-repos.js";

function makeDb({ batchResults = [] } = {}) {
  const calls = { batch: [] };
  return {
    prepare(sql) {
      return {
        _sql: sql,
        _binds: [],
        bind(...binds) { this._binds = binds; return this; },
      };
    },
    async batch(stmts) {
      calls.batch.push(stmts.map((s) => ({ sql: s._sql, binds: s._binds })));
      return batchResults;
    },
    _calls: calls,
  };
}

function makeCtx({ db, url = "http://x/api/prs" }) {
  return { request: new Request(url), env: { DB: db }, data: { orgId: 1, orgLogin: "acme" } };
}

beforeEach(() => getActiveRepoNames.mockReset());

describe("GET /api/prs", () => {
  it("returns empty stats when there are no active repos", async () => {
    getActiveRepoNames.mockResolvedValue([]);
    const db = makeDb();
    const res = await onRequestGet(makeCtx({ db, url: "http://x/api/prs?meta=stats" }));
    expect(await res.json()).toEqual({ open: 0, draft: 0, stale: 0, byRepo: [] });
  });

  it("returns stats with draft count merged into byRepo", async () => {
    getActiveRepoNames.mockResolvedValue(["api", "web"]);
    const db = makeDb({
      batchResults: [
        { results: [{ c: 10 }] },        // openCount
        { results: [{ c: 3 }] },         // draftCount
        { results: [{ c: 2 }] },         // staleCount
        { results: [{ repo: "api", count: 7 }, { repo: "web", count: 3 }] }, // byRepo
        { results: [{ repo: "api", count: 2 }] },                            // draftByRepo
      ],
    });
    const res = await onRequestGet(makeCtx({ db, url: "http://x/api/prs?meta=stats" }));
    const body = await res.json();
    expect(body).toEqual({
      open: 10,
      draft: 3,
      stale: 2,
      byRepo: [
        { repo: "api", count: 7, draft: 2 },
        { repo: "web", count: 3, draft: 0 },
      ],
    });
  });

  it("returns empty page when there are no active repos", async () => {
    getActiveRepoNames.mockResolvedValue([]);
    const db = makeDb();
    const res = await onRequestGet(makeCtx({ db }));
    expect(await res.json()).toEqual({ data: [], totalCount: 0, page: 1, pageSize: 100 });
  });

  it("returns empty page when ?repo= is not in the active set", async () => {
    getActiveRepoNames.mockResolvedValue(["api"]);
    const db = makeDb();
    const res = await onRequestGet(makeCtx({ db, url: "http://x/api/prs?repo=stranger" }));
    expect(await res.json()).toEqual({ data: [], totalCount: 0, page: 1, pageSize: 100 });
  });

  it("parses JSON fields and casts draft to boolean", async () => {
    getActiveRepoNames.mockResolvedValue(["api"]);
    const db = makeDb({
      batchResults: [
        { results: [{ count: 1 }] },
        { results: [{ repo: "api", number: 100, title: "Fix", draft: 1, requested_reviewers_json: '[{"login":"alice"}]', labels_json: '[]' }] },
      ],
    });
    const res = await onRequestGet(makeCtx({ db }));
    const body = await res.json();
    expect(body.data[0].draft).toBe(true);
    expect(body.data[0].requested_reviewers).toEqual([{ login: "alice" }]);
    expect(body.data[0].labels).toEqual([]);
    expect(body.totalCount).toBe(1);
  });

  it("appends state/author/since/draft/stale filters", async () => {
    getActiveRepoNames.mockResolvedValue(["api"]);
    const db = makeDb({ batchResults: [{ results: [{ count: 0 }] }, { results: [] }] });
    await onRequestGet(makeCtx({ db, url: "http://x/api/prs?state=open&author=alice&since=2025-01-01&draft=1&stale=1" }));
    const dataStmt = db._calls.batch[0][1];
    expect(dataStmt.sql).toMatch(/state = \?/);
    expect(dataStmt.sql).toMatch(/author = \?/);
    expect(dataStmt.sql).toMatch(/updated_at >= \?/);
    expect(dataStmt.sql).toMatch(/draft = 1/);
    expect(dataStmt.sql).toMatch(/state = 'open' AND created_at < \?/);
    expect(dataStmt.binds).toContain("open");
    expect(dataStmt.binds).toContain("alice");
    expect(dataStmt.binds).toContain("2025-01-01");
  });
});
