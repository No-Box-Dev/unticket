import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/llm.js", () => ({
  probeCompletion: vi.fn(),
}));
vi.mock("../../lib/crypto.js", () => ({
  encryptToken: vi.fn(async (plain, _key) => `enc:${plain}`),
  decryptToken: vi.fn(async (cipher, _key) => {
    if (typeof cipher === "string" && cipher.startsWith("enc:")) return cipher.slice(4);
    if (cipher === "corrupt") throw new Error("bad MAC");
    return cipher;
  }),
}));

import {
  onRequestGet,
  onRequestPut,
  onRequestDelete,
  isPrivateHostname,
  formatProbeFailure,
} from "../llm-settings";
import { probeCompletion } from "../../lib/llm.js";
import { encryptToken, decryptToken } from "../../lib/crypto.js";

// Probes that succeed by default — individual tests override per-call.
const okProbe = { ok: true, text: "ok" };

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

  it("returns provider/baseUrl/model + key prefix when a row exists", async () => {
    const { ctx } = makeCtx({
      settingsRow: {
        provider: "openai-compatible",
        base_url: "https://proxy.example.com",
        model: "gpt-4o-mini",
        key_prefix: "sk-pro",
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
      keyMask: "sk-pro…",
      updatedAt: "2026-05-21T10:00:00Z",
    });
  });

  it("falls back to ••• when the row pre-dates the key_prefix column", async () => {
    const { ctx } = makeCtx({
      settingsRow: {
        provider: "anthropic",
        base_url: "https://api.anthropic.com",
        model: "claude-sonnet-4-6",
        key_prefix: null,
        updated_at: "2026-05-20T10:00:00Z",
      },
    });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keyMask).toBe("••••");
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
    expect(probeCompletion).not.toHaveBeenCalled();
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
    expect(probeCompletion).not.toHaveBeenCalled();
  });

  it("422s on missing apiKey when no row exists", async () => {
    const { ctx } = makeCtx({
      method: "PUT",
      body: { ...goodBody, apiKey: "" },
      settingsRow: null,
    });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(422);
    expect(probeCompletion).not.toHaveBeenCalled();
  });

  it("reuses the stored key when apiKey is blank and a row exists", async () => {
    probeCompletion.mockResolvedValueOnce(okProbe);
    const { ctx, DB } = makeCtx({
      method: "PUT",
      body: { ...goodBody, apiKey: "" },
      settingsRow: { encrypted_api_key: "enc:sk-ant-stored-secret" },
    });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(200);

    // The probe should have been called with the decrypted stored key.
    expect(decryptToken).toHaveBeenCalledWith("enc:sk-ant-stored-secret", "0".repeat(64));
    expect(probeCompletion.mock.calls[0][0]).toMatchObject({ apiKey: "sk-ant-stored-secret" });

    // The row is re-upserted; encryption happens with the reused plaintext.
    expect(encryptToken).toHaveBeenCalledWith("sk-ant-stored-secret", "0".repeat(64));
    const run = DB._calls.runs.find((r) => r.sql.includes("INSERT INTO llm_settings"));
    expect(run).toBeDefined();

    const body = await res.json();
    expect(body).toMatchObject({
      configured: true,
      model: "claude-sonnet-4-6",
      keyMask: "sk-ant…",
      keyReused: true,
    });
  });

  it("422s when the stored key cannot be decrypted", async () => {
    const { ctx } = makeCtx({
      method: "PUT",
      body: { ...goodBody, apiKey: "" },
      settingsRow: { encrypted_api_key: "corrupt" },
    });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/decrypt/i);
    expect(probeCompletion).not.toHaveBeenCalled();
  });

  it("422s on non-https baseUrl scheme", async () => {
    const { ctx } = makeCtx({
      orgId: 101,
      method: "PUT",
      body: { ...goodBody, baseUrl: "ftp://nope.example.com" },
    });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(422);
    expect(probeCompletion).not.toHaveBeenCalled();
  });

  it("422s on http:// baseUrl (plaintext would leak the API key)", async () => {
    const { ctx } = makeCtx({
      orgId: 102,
      method: "PUT",
      body: { ...goodBody, baseUrl: "http://api.anthropic.com" },
    });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(422);
    expect(probeCompletion).not.toHaveBeenCalled();
  });

  it("422s when baseUrl is not a parseable URL", async () => {
    const { ctx } = makeCtx({
      orgId: 103,
      method: "PUT",
      body: { ...goodBody, baseUrl: "not a url at all" },
    });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(422);
    expect(probeCompletion).not.toHaveBeenCalled();
  });

  it.each([
    ["localhost", "https://localhost/v1"],
    ["loopback IPv4", "https://127.0.0.1/v1"],
    ["private RFC1918 10.x", "https://10.0.0.5/v1"],
    ["private RFC1918 192.168.x", "https://192.168.1.1/v1"],
    ["AWS/GCP metadata 169.254.169.254", "https://169.254.169.254/latest/meta-data/"],
    ["IPv6 loopback", "https://[::1]/v1"],
    ["mDNS .local", "https://printer.local/v1"],
    ["resolver-internal .internal", "https://svc.internal/v1"],
  ])("422s when baseUrl points at a private host (%s)", async (_label, baseUrl) => {
    const { ctx } = makeCtx({
      orgId: 200 + Math.floor(Math.random() * 1000),
      method: "PUT",
      body: { ...goodBody, baseUrl },
    });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(422);
    expect(probeCompletion).not.toHaveBeenCalled();
  });

  it("422s when validation probe fails — and bubbles up provider's actual error", async () => {
    probeCompletion.mockResolvedValueOnce({
      ok: false,
      reason: "http_error",
      status: 401,
      bodySnippet: '{"error":{"message":"Authentication Error: Invalid API key"}}',
    });
    const { ctx, DB } = makeCtx({ method: "PUT", body: goodBody });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(422);
    expect(DB._calls.runs).toHaveLength(0);
    const body = await res.json();
    expect(body.error).toMatch(/HTTP 401/);
    expect(body.error).toMatch(/Authentication Error: Invalid API key/);
  });

  it("upserts the row and returns a masked key on success", async () => {
    probeCompletion.mockResolvedValueOnce(okProbe);
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
      "sk-ant",
    ]);
    const body = await res.json();
    expect(body).toMatchObject({
      configured: true,
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-6",
      keyMask: "sk-ant…",
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

describe("PUT rate limit", () => {
  const goodBody = {
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKey: "sk-ant-rate",
    model: "claude-sonnet-4-6",
  };

  it("429s after RATE_LIMIT_MAX attempts in the window", async () => {
    probeCompletion.mockResolvedValue(okProbe);
    const orgId = 9999;

    // First 10 attempts should succeed (200).
    for (let i = 0; i < 10; i++) {
      const { ctx } = makeCtx({ orgId, method: "PUT", body: goodBody });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(200);
    }

    // 11th attempt within the window is rejected before the probe runs.
    probeCompletion.mockClear();
    const { ctx } = makeCtx({ orgId, method: "PUT", body: goodBody });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(429);
    expect(probeCompletion).not.toHaveBeenCalled();
  });

  it("rate-limits per org (one org hitting the cap does not block another)", async () => {
    probeCompletion.mockResolvedValue(okProbe);
    const cappedOrg = 9998;
    // Fill cappedOrg's window.
    for (let i = 0; i < 10; i++) {
      const { ctx } = makeCtx({ orgId: cappedOrg, method: "PUT", body: goodBody });
      const res = await onRequestPut(ctx);
      expect(res.status).toBe(200);
    }
    // A fresh org should still be allowed.
    const { ctx } = makeCtx({ orgId: 9997, method: "PUT", body: goodBody });
    const res = await onRequestPut(ctx);
    expect(res.status).toBe(200);
  });
});

describe("isPrivateHostname", () => {
  it.each([
    "localhost",
    "Localhost",
    "anything.local",
    "service.internal",
    "127.0.0.1",
    "0.0.0.0",
    "10.0.0.1",
    "169.254.169.254", // AWS/GCP IMDS
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "224.0.0.1", // multicast
    "::1",
    "[::1]", // bracketed form as URL.hostname returns it
    "::",
    "fc00::1", // ULA
    "fd12:3456::1", // ULA
    "fe80::1", // link-local
    "::ffff:127.0.0.1", // IPv4-mapped
  ])("treats %s as private", (host) => {
    expect(isPrivateHostname(host)).toBe(true);
  });

  it.each([
    "api.anthropic.com",
    "api.openai.com",
    "api.z.ai",
    "8.8.8.8",
    "172.15.0.1", // just outside the 172.16/12 block
    "172.32.0.1", // just outside the 172.16/12 block
    "2606:4700::1111", // public Cloudflare IPv6
  ])("treats %s as public", (host) => {
    expect(isPrivateHostname(host)).toBe(false);
  });

  it("treats empty/missing hostnames as private (fail-secure)", () => {
    expect(isPrivateHostname("")).toBe(true);
    expect(isPrivateHostname(undefined)).toBe(true);
    expect(isPrivateHostname(null)).toBe(true);
  });
});

describe("formatProbeFailure", () => {
  it("401/403 → key-rejected message + extracts provider's JSON error message", () => {
    const msg = formatProbeFailure({
      ok: false,
      reason: "http_error",
      status: 401,
      bodySnippet: '{"error":{"message":"Authentication Error: Invalid API key"}}',
    });
    expect(msg).toMatch(/HTTP 401/);
    expect(msg).toMatch(/rejected the API key/i);
    expect(msg).toContain("Authentication Error: Invalid API key");
  });

  it("404 → base-URL guidance + LiteLLM/OpenAI proxy hint", () => {
    const msg = formatProbeFailure({
      ok: false,
      reason: "http_error",
      status: 404,
      bodySnippet: "",
    });
    expect(msg).toMatch(/HTTP 404/);
    expect(msg).toMatch(/Base URL/);
    expect(msg).toMatch(/no \/v1/);
  });

  it("400 → model-name hint", () => {
    const msg = formatProbeFailure({
      ok: false,
      reason: "http_error",
      status: 400,
      bodySnippet: '{"error":{"message":"model gpt-foo not found"}}',
    });
    expect(msg).toMatch(/HTTP 400/);
    expect(msg).toMatch(/model name/i);
    expect(msg).toContain("model gpt-foo not found");
  });

  it("429 → rate-limit guidance", () => {
    const msg = formatProbeFailure({ ok: false, reason: "http_error", status: 429, bodySnippet: "" });
    expect(msg).toMatch(/HTTP 429/);
    expect(msg).toMatch(/rate-limited/i);
  });

  it("5xx → provider outage hint", () => {
    const msg = formatProbeFailure({ ok: false, reason: "http_error", status: 503, bodySnippet: "" });
    expect(msg).toMatch(/HTTP 503/);
    expect(msg).toMatch(/outage/i);
  });

  it("network → host-unreachable message includes the underlying error", () => {
    const msg = formatProbeFailure({
      ok: false,
      reason: "network",
      message: "getaddrinfo ENOTFOUND litellm.example.com",
    });
    expect(msg).toMatch(/Couldn't reach/);
    expect(msg).toContain("ENOTFOUND");
  });

  it("timeout → 30s timeout message", () => {
    const msg = formatProbeFailure({ ok: false, reason: "timeout" });
    expect(msg).toMatch(/timed out after 30s/);
  });

  it("bad_json → wrong-endpoint hint WITHOUT echoing the raw body", () => {
    const msg = formatProbeFailure({
      ok: false,
      reason: "bad_json",
      bodySnippet: "<!DOCTYPE html><html><head><title>Login</title>",
    });
    expect(msg).toMatch(/non-JSON/);
    // Must not reflect arbitrary response bytes back to the caller (SSRF/info oracle).
    expect(msg).not.toContain("<!DOCTYPE html>");
  });

  it("no_text_block → model-shape hint WITHOUT echoing the raw body", () => {
    const msg = formatProbeFailure({
      ok: false,
      reason: "no_text_block",
      bodySnippet: '{"choices":[{"finish_reason":"length","message":{"content":null}}]}',
    });
    expect(msg).toMatch(/no text content/i);
    expect(msg).toMatch(/reasoning model/i);
    expect(msg).not.toContain("finish_reason");
  });

  it("surfaces a structured provider error message but never the raw body", () => {
    // Structured { error: { message } } is surfaced…
    const structured = formatProbeFailure({
      ok: false,
      reason: "http_error",
      status: 401,
      bodySnippet: '{"error":{"message":"Invalid API key"}}',
    });
    expect(structured).toContain("Invalid API key");
    // …but a non-JSON body is NOT reflected back.
    const raw = formatProbeFailure({
      ok: false,
      reason: "http_error",
      status: 502,
      bodySnippet: "Bad Gateway secret-internal-banner",
    });
    expect(raw).not.toContain("secret-internal-banner");
    expect(raw).toMatch(/HTTP 502/);
  });

  it("default branch returns the original generic message", () => {
    const msg = formatProbeFailure({ ok: false, reason: "unknown_thing_we_havent_handled" });
    expect(msg).toMatch(/Validation call failed/);
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
