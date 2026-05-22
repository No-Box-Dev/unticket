import { describe, it, expect, vi, beforeEach } from "vitest";

import { onRequestGet } from "../op-failures.js";

function makeDb(rows = []) {
  const all = vi.fn().mockResolvedValue({ results: rows });
  const bind = vi.fn().mockReturnValue({ all });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { prepare, _bind: bind };
}

function makeCtx({
  url = "http://x/api/op-failures",
  isAdmin = true,
  orgLogin = "acme",
  rows = [],
} = {}) {
  const DB = makeDb(rows);
  return {
    ctx: {
      request: new Request(url, { method: "GET" }),
      env: { DB },
      data: { orgId: 1, orgLogin, isAdmin },
    },
    DB,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/op-failures", () => {
  it("403s when caller is not admin", async () => {
    const { ctx, DB } = makeCtx({ isAdmin: false });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(403);
    expect(DB.prepare).not.toHaveBeenCalled();
  });

  it("400s when orgLogin is missing", async () => {
    const { ctx } = makeCtx({ orgLogin: null });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it("returns recent failures for the org", async () => {
    const sample = [
      {
        id: 2,
        op: "narrateEvent",
        delivery_id: "abc",
        error: "rate limited",
        occurred_at: "2026-05-20T10:00:00",
      },
      {
        id: 1,
        op: "matchPRToFeatures",
        delivery_id: "repo#1",
        error: "boom",
        occurred_at: "2026-05-20T09:00:00",
      },
    ];
    const { ctx, DB } = makeCtx({ rows: sample });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.failures).toEqual(sample);
    expect(DB._bind).toHaveBeenCalledWith("acme", 25);
  });

  it("clamps limit to 100", async () => {
    const { ctx, DB } = makeCtx({ url: "http://x/api/op-failures?limit=9999" });
    await onRequestGet(ctx);
    expect(DB._bind).toHaveBeenCalledWith("acme", 100);
  });

  it("floors limit at 1", async () => {
    const { ctx, DB } = makeCtx({ url: "http://x/api/op-failures?limit=0" });
    await onRequestGet(ctx);
    // 0 falls through to DEFAULT_ROWS=25, since Number("0") || 25 === 25
    expect(DB._bind).toHaveBeenCalledWith("acme", 25);
  });
});
