import { describe, it, expect } from "vitest";
import { onRequestGet, onRequestPut, onRequestDelete } from "../features.js";

function makeDb({ batchResults = [], runResult = { meta: { changes: 1 } } } = {}) {
  const calls = { batch: [], run: [], prepared: [] };
  function prepare(sql) {
    calls.prepared.push(sql);
    return {
      _sql: sql,
      _binds: [],
      bind(...binds) { this._binds = binds; return this; },
      async run() { calls.run.push({ sql, binds: this._binds }); return runResult; },
    };
  }
  return {
    prepare,
    async batch(stmts) {
      calls.batch.push(stmts.map((s) => ({ sql: s._sql, binds: s._binds })));
      return batchResults;
    },
    _calls: calls,
  };
}

function makeCtx({ db, url = "http://x/api/features", method = "GET", body }) {
  const req = body !== undefined
    ? new Request(url, { method, headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) })
    : new Request(url, { method });
  return { request: req, env: { DB: db }, data: { orgId: 1, orgLogin: "acme" } };
}

describe("GET /api/features", () => {
  it("hydrates linkedPRs from pr_feature_links (not body metadata)", async () => {
    const db = makeDb({
      batchResults: [
        { results: [
          { number: 42, title: "Login", state: "open", body: "Plan", assignees_json: '[]', labels_json: '[]' },
          { number: 43, title: "Signup", state: "open", body: "Plan", assignees_json: '[]', labels_json: '[]' },
        ] },
        { results: [
          { feature_number: 42, pr_repo: "api", pr_number: 100 },
          { feature_number: 42, pr_repo: "web", pr_number: 200 },
        ] },
      ],
    });
    const res = await onRequestGet(makeCtx({ db }));
    const data = await res.json();
    expect(data).toHaveLength(2);
    expect(data[0].linkedPRs).toEqual([{ repo: "api", number: 100 }, { repo: "web", number: 200 }]);
    expect(data[1].linkedPRs).toEqual([]);
  });

  it("filters by state from query param (default 'open')", async () => {
    const db = makeDb({ batchResults: [{ results: [] }, { results: [] }] });
    await onRequestGet(makeCtx({ db, url: "http://x/api/features?state=closed" }));
    expect(db._calls.batch[0][0].binds).toEqual([1, "closed"]);
  });
});

describe("PUT /api/features", () => {
  it("400s on invalid JSON", async () => {
    const res = await onRequestPut(makeCtx({ db: makeDb(), method: "PUT", body: "{ broken" }));
    expect(res.status).toBe(400);
  });

  it("400s on missing number", async () => {
    const res = await onRequestPut(makeCtx({ db: makeDb(), method: "PUT", body: { title: "X" } }));
    expect(res.status).toBe(400);
  });

  it("400s on missing/empty title", async () => {
    const res = await onRequestPut(makeCtx({ db: makeDb(), method: "PUT", body: { number: 1, title: "" } }));
    expect(res.status).toBe(400);
  });

  it("upserts with sensible defaults", async () => {
    const db = makeDb();
    const res = await onRequestPut(makeCtx({ db, method: "PUT", body: { number: 42, title: "Login" } }));
    expect(res.status).toBe(200);
    expect(db._calls.run).toHaveLength(1);
    // body field gets ""; assignees + labels JSON-encoded as []; milestone null
    const binds = db._calls.run[0].binds;
    expect(binds[0]).toBe(1);
    expect(binds[1]).toBe(42);
    expect(binds[2]).toBe("Login");
    expect(binds[3]).toBe("open");  // default state
    expect(binds[5]).toBe("[]");
    expect(binds[6]).toBe("[]");
  });
});

describe("DELETE /api/features?number=N", () => {
  it("400s on non-integer number", async () => {
    const db = makeDb();
    const res = await onRequestDelete(makeCtx({ db, url: "http://x/api/features?number=abc", method: "DELETE" }));
    expect(res.status).toBe(400);
  });

  it("marks feature as closed", async () => {
    const db = makeDb();
    const res = await onRequestDelete(makeCtx({ db, url: "http://x/api/features?number=42", method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(db._calls.run[0].sql).toMatch(/UPDATE features SET state = 'closed'/);
    expect(db._calls.run[0].binds).toEqual([1, 42]);
  });
});
