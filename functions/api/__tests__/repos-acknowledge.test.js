import { describe, it, expect, vi, beforeEach } from "vitest";

import { onRequestPost } from "../repos/acknowledge";

function makeDb() {
  const calls = { run: [] };
  return {
    prepare(sql) {
      return {
        _sql: sql,
        _binds: [],
        bind(...binds) { this._binds = binds; return this; },
        async run() {
          calls.run.push({ sql, binds: this._binds });
          return { meta: { changes: this._binds.length - 1 } };
        },
      };
    },
    _calls: calls,
  };
}

function makeContext({ db, body, orgId = 1, isAdmin = true }) {
  const req = new Request("http://x/api/repos/acknowledge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { request: req, env: { DB: db }, data: { orgId, isAdmin } };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/repos/acknowledge", () => {
  it("403s for non-admins (caller can't surface new repos to the org)", async () => {
    const res = await onRequestPost(makeContext({
      db: makeDb(),
      body: { names: ["api"] },
      isAdmin: false,
    }));
    expect(res.status).toBe(403);
  });

  it("400s on missing org context", async () => {
    const res = await onRequestPost(makeContext({
      db: makeDb(),
      body: { names: ["api"] },
      orgId: 0,
    }));
    expect(res.status).toBe(400);
  });

  it("400s on malformed JSON body", async () => {
    const res = await onRequestPost(makeContext({
      db: makeDb(),
      body: "{not json",
    }));
    expect(res.status).toBe(400);
  });

  it("400s when names is empty", async () => {
    const res = await onRequestPost(makeContext({
      db: makeDb(),
      body: { names: [] },
    }));
    expect(res.status).toBe(400);
  });

  it("400s when a repo name contains path-traversal characters", async () => {
    const res = await onRequestPost(makeContext({
      db: makeDb(),
      body: { names: ["../etc/passwd"] },
    }));
    expect(res.status).toBe(400);
  });

  it("acknowledges a single repo with the expected SQL shape", async () => {
    const db = makeDb();
    const res = await onRequestPost(makeContext({
      db,
      body: { names: ["api"] },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.acknowledged).toEqual(["api"]);
    const sql = db._calls.run[0].sql;
    expect(sql).toContain("UPDATE repos");
    expect(sql).toContain("COALESCE(acknowledged_at,");
    // First bind is org_id, then the names — orgId=1, name=api.
    expect(db._calls.run[0].binds[0]).toBe(1);
    expect(db._calls.run[0].binds[1]).toBe("api");
  });

  it("deduplicates repeated names before binding", async () => {
    const db = makeDb();
    await onRequestPost(makeContext({
      db,
      body: { names: ["api", "api", "web"] },
    }));
    // 1 org id + 2 unique names = 3 binds total.
    expect(db._calls.run[0].binds).toHaveLength(3);
    expect(db._calls.run[0].binds.slice(1).sort()).toEqual(["api", "web"]);
  });

  it("400s when too many names are submitted (DoS guard)", async () => {
    const names = Array.from({ length: 501 }, (_, i) => `repo-${i}`);
    const res = await onRequestPost(makeContext({
      db: makeDb(),
      body: { names },
    }));
    expect(res.status).toBe(400);
  });
});
