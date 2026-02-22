import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch, apiGet, apiPut, apiPost } from "../api";

let storage: Record<string, string> = {};

beforeEach(() => {
  storage = {};

  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, val: string) => { storage[key] = val; },
    removeItem: (key: string) => { delete storage[key]; },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Server Error",
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("apiFetch", () => {
  it("injects Authorization and X-Org headers from localStorage", async () => {
    storage.gp_token = "tok123";
    storage.gp_org = "my-org";
    const fn = mockFetch(200, {});

    await apiFetch("/api/test");

    expect(fn).toHaveBeenCalledWith("/api/test", expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer tok123",
        "X-Org": "my-org",
      }),
    }));
  });

  it("uses empty strings when localStorage is empty", async () => {
    const fn = mockFetch(200, {});

    await apiFetch("/api/test");

    expect(fn).toHaveBeenCalledWith("/api/test", expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer ",
        "X-Org": "",
      }),
    }));
  });

  it("merges caller-provided headers", async () => {
    storage.gp_token = "tok";
    const fn = mockFetch(200, {});

    await apiFetch("/api/test", {
      headers: { "X-Custom": "val" },
    });

    const passedHeaders = fn.mock.calls[0][1].headers;
    expect(passedHeaders["X-Custom"]).toBe("val");
    expect(passedHeaders["Authorization"]).toBe("Bearer tok");
  });
});

describe("apiGet", () => {
  it("returns parsed JSON on 200", async () => {
    mockFetch(200, { data: "hello" });
    const result = await apiGet("/api/data");
    expect(result).toEqual({ data: "hello" });
  });

  it("throws with body.error on non-ok response", async () => {
    mockFetch(400, { error: "bad request" });
    await expect(apiGet("/api/data")).rejects.toThrow("bad request");
  });

  it("throws with status text when body unparseable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.reject(new Error("parse fail")),
    }));
    await expect(apiGet("/api/data")).rejects.toThrow("Internal Server Error");
  });
});

describe("apiPut", () => {
  it("sends PUT with JSON body", async () => {
    const fn = mockFetch(200, { ok: true });
    await apiPut("/api/config/features", [1, 2]);

    expect(fn).toHaveBeenCalledWith("/api/config/features", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify([1, 2]),
    }));
  });

  it("throws on non-ok", async () => {
    mockFetch(403, { error: "forbidden" });
    await expect(apiPut("/api/x", {})).rejects.toThrow("forbidden");
  });
});

describe("apiPost", () => {
  it("sends POST with JSON body", async () => {
    const fn = mockFetch(200, { ok: true });
    await apiPost("/api/sync", { force: true });

    expect(fn).toHaveBeenCalledWith("/api/sync", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ force: true }),
    }));
  });

  it("omits body when undefined", async () => {
    const fn = mockFetch(200, { ok: true });
    await apiPost("/api/sync");

    expect(fn).toHaveBeenCalledWith("/api/sync", expect.objectContaining({
      method: "POST",
      body: undefined,
    }));
  });
});
