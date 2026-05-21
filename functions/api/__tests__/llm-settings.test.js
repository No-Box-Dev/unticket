import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/llm.js", () => ({
  complete: vi.fn(),
}));
vi.mock("../../lib/crypto.js", () => ({
  encryptToken: vi.fn(async (plain, _key) => `enc:${plain}`),
}));

import {
  onRequestGet,
  onRequestPut,
  onRequestDelete,
} from "../llm-settings.js";
import { complete } from "../../lib/llm.js";
import { encryptToken } from "../../lib/crypto.js";

// D1 stub that dispatches by SQL substring. Tests configure a `settingsRow`
// (returned by the GET path's first()) and inspect captured runs/binds for
// PUT/DELETE side effects.
function makeDb({ settingsRow = null } = {}) {
  const calls = { firsts: [], runs: [] };
  function prepare(sql) {
    return {
      _binds: [],
      bind(...binds) { this._binds = binds; return this; },
      async first() {
        calls.firsts.push({ sql, binds: this._binds });
        if (sql.includes("FROM llm_settings")) return settingsRow;
        return null;
      },
      async run() {
        calls.runs.push({ sql, binds: this._binds });
        return { meta: { changes: 1 } };
      },
    };
  }
  return { prepare, _calls: calls };
}

function makeCtx({
  method = "GET",
  body = null,
  isAdmin = true,
  orgId = 7,
  encryptionKey = "0".repeat(64),
  settingsRow = null,
} = {}) {
  const DB = makeDb({ settingsRow });
  const init = { method };
  if (body !== null) init.body = JSON.stringify(body);
  return {
    ctx: {
      request: new Request("http://x/api/llm-settings", init),
      env: { DB, ENCRYPTION_KEY: encryptionKey },
      data: { orgId, isAdmin, orgLogin: "acme" },
    },
    DB,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/llm-settings", () => {
  it("403s for non-admin callers", async () => {
    const { ctx } = makeCtx({ isAdmin: false });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(403);
  });

  it("400s when orgId is missing", async () => {
    const { ctx } = makeCtx({ orgId: null });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it("returns configured:false when no row exists", async () => {
    const { ctx } = makeCtx();
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: false });
  });

  it("returns provider/baseUrl/model + masked key when a row exists", async () => {
    const { ctx } = makeCtx({
      settingsRow: {
        provider: "openai-compatible",
        base_url: "https://proxy.example.com",
        model: "gpt-4o-mini",
        updated_at: "2026-05-21T10:00:00Z",
      },
    });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      configured: true,
      provider: "openai-compatible",
      baseUrl: "https://proxy.example.com",
      model: "gpt-4o-mini",
      keyMask: "••••",
      updatedAt: "2026-05-21T10:00:00Z",
    });
  });
});

describe("PUT /api/llm-settings", () => {
  const goodBody = {
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKey: "sk-ant-XXXXxxxx",
    model: "claude-sonnet-4-6",
  };

  it("403s for non-admin callers", async () => {
    const { ctx } = makeCtx({ method: "PUT", body: goodBody, isAdmin: false });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(403);
    expect(complete).not.toHaveBeenCalled();
  });

  it("500s when ENCRYPTION_KEY is missing", async () => {
    const { ctx } = makeCtx({ method: "PUT", body: goodBody, encryptionKey: null });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(500);
  });

  it("422s on invalid provider", async () => {
    const { ctx } = makeCtx({
      method: "PUT",
      body: { ...goodBody, provider: "magic-cloud" },
    });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(422);
    expect(complete).not.toHaveBeenCalled();
  });

  it("422s on missing apiKey", async () => {
    const { ctx } = makeCtx({
      method: "PUT",
      body: { ...goodBody, apiKey: "" },
    });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(422);
  });

  it("422s on non-http baseUrl", async () => {
    const { ctx } = makeCtx({
      method: "PUT",
      body: { ...goodBody, baseUrl: "ftp://nope" },
    });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(422);
  });

  it("422s when validation probe returns null", async () => {
    complete.mockResolvedValueOnce(null);
    const { ctx, DB } = makeCtx({ method: "PUT", body: goodBody });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(422);
    expect(DB._calls.runs).toHaveLength(0);
  });

  it("upserts the row and returns a masked key on success", async () => {
    complete.mockResolvedValueOnce("ok");
    const { ctx, DB } = makeCtx({ method: "PUT", body: goodBody });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(200);

    expect(encryptToken).toHaveBeenCalledWith("sk-ant-XXXXxxxx", "0".repeat(64));
    expect(DB._calls.runs).toHaveLength(1);
    const run = DB._calls.runs[0];
    expect(run.sql).toContain("INSERT INTO llm_settings");
    expect(run.binds).toEqual([
      7,
      "anthropic",
      "https://api.anthropic.com",
      "enc:sk-ant-XXXXxxxx",
      "claude-sonnet-4-6",
    ]);
    const body = await res.json();
    expect(body).toMatchObject({
      configured: true,
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-6",
      keyMask: "••••xxxx",
    });
  });

  it("400s on non-JSON body", async () => {
    const DB = makeDb();
    const ctx = {
      request: new Request("http://x/api/llm-settings", { method: "PUT", body: "not-json" }),
      env: { DB, ENCRYPTION_KEY: "0".repeat(64) },
      data: { orgId: 7, isAdmin: true },
    };
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/llm-settings", () => {
  it("403s for non-admin callers", async () => {
    const { ctx } = makeCtx({ method: "DELETE", isAdmin: false });
    const res = await onRequestDelete(ctx);
    expect(res.status).toBe(403);
  });

  it("deletes the row and returns configured:false", async () => {
    const { ctx, DB } = makeCtx({ method: "DELETE" });
    const res = await onRequestDelete(ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: false });
    expect(DB._calls.runs).toHaveLength(1);
    expect(DB._calls.runs[0].sql).toContain("DELETE FROM llm_settings");
    expect(DB._calls.runs[0].binds).toEqual([7]);
  });
});
