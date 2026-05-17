import { describe, it, expect } from "vitest";
import { getCtx, jsonResponse, errorResponse, getSyncState, setSyncState } from "../db.js";

describe("getCtx", () => {
  it("returns the data property of the Pages Function context", () => {
    expect(getCtx({ data: { orgId: "x" } })).toEqual({ orgId: "x" });
  });
});

describe("jsonResponse", () => {
  it("returns a 200 JSON response by default", async () => {
    const r = jsonResponse({ ok: true });
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("application/json");
    expect(await r.json()).toEqual({ ok: true });
  });

  it("respects an explicit status code", () => {
    expect(jsonResponse({}, 201).status).toBe(201);
  });
});

describe("errorResponse", () => {
  it("returns a 400 with an {error} body by default", async () => {
    const r = errorResponse("nope");
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "nope" });
  });

  it("respects an explicit status code", () => {
    expect(errorResponse("x", 500).status).toBe(500);
  });
});

function makeDb({ row = null } = {}) {
  const calls = { firsts: [], runs: [] };
  function prepare(sql) {
    return {
      _sql: sql,
      _binds: [],
      bind(...binds) { this._binds = binds; return this; },
      async first() { calls.firsts.push({ sql, binds: this._binds }); return row; },
      async run() { calls.runs.push({ sql, binds: this._binds }); return {}; },
    };
  }
  return { prepare, _calls: calls };
}

describe("getSyncState", () => {
  it("returns null when no row exists", async () => {
    expect(await getSyncState(makeDb(), "org", "issues")).toBeNull();
  });

  it("returns mapped row when found", async () => {
    const db = makeDb({ row: { last_synced: "2026-05-01T00:00:00Z", etag: 'W/"abc"' } });
    expect(await getSyncState(db, "org", "issues")).toEqual({
      lastSynced: "2026-05-01T00:00:00Z",
      etag: 'W/"abc"',
    });
  });

  it("binds org_id and resource", async () => {
    const db = makeDb();
    await getSyncState(db, "org-1", "prs");
    expect(db._calls.firsts[0].binds).toEqual(["org-1", "prs"]);
  });
});

describe("setSyncState", () => {
  it("runs an INSERT ... ON CONFLICT statement", async () => {
    const db = makeDb();
    await setSyncState(db, "org-1", "issues", 'W/"abc"');
    expect(db._calls.runs[0].sql).toMatch(/INSERT INTO sync_state/);
    expect(db._calls.runs[0].sql).toMatch(/ON CONFLICT\(org_id, resource\)/);
  });

  it("binds etag = null when not provided", async () => {
    const db = makeDb();
    await setSyncState(db, "org-1", "issues");
    expect(db._calls.runs[0].binds).toEqual(["org-1", "issues", null]);
  });

  it("passes etag through when provided", async () => {
    const db = makeDb();
    await setSyncState(db, "org-1", "issues", 'W/"xyz"');
    expect(db._calls.runs[0].binds[2]).toBe('W/"xyz"');
  });
});
