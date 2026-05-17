import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { complete, completeNarrative, NARRATOR_MODEL, ZHIPU_MODEL } from "../llm.js";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("complete", () => {
  it("returns null when no API key is provided", async () => {
    expect(await complete(null, { system: "s", user: "u" })).toBeNull();
    expect(await complete("", { system: "s", user: "u" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("POSTs to the Zhipu endpoint with the right headers + body", async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "hi" }] }),
    });
    const result = await complete("key", { system: "sys", user: "usr", maxTokens: 50, tag: "test" });
    expect(result).toBe("hi");

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.z.ai/api/anthropic/v1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("key");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: "glm-5",
      max_tokens: 50,
      system: "sys",
      messages: [{ role: "user", content: "usr" }],
    });
  });

  it("returns null on non-2xx response (and warns)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    expect(await complete("key", { system: "s", user: "u", tag: "tag" })).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[tag] Zhipu returned 503"));
  });

  it("returns null on fetch throw (and warns)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetch.mockRejectedValue(new Error("network down"));
    expect(await complete("key", { system: "s", user: "u" })).toBeNull();
  });

  it("returns null when content array has no text block", async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "tool_use" }] }),
    });
    expect(await complete("key", { system: "s", user: "u" })).toBeNull();
  });

  it("returns null when content is missing", async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    expect(await complete("key", { system: "s", user: "u" })).toBeNull();
  });

  it("uses default max_tokens (220) when not specified", async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ content: [{ type: "text", text: "x" }] }) });
    await complete("key", { system: "s", user: "u" });
    expect(JSON.parse(fetch.mock.calls[0][1].body).max_tokens).toBe(220);
  });
});

describe("completeNarrative", () => {
  it("strips matching double quotes", async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ content: [{ type: "text", text: '"hello"' }] }) });
    expect(await completeNarrative("key", "s", "u")).toBe("hello");
  });

  it("strips matching single quotes", async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ content: [{ type: "text", text: "'hi there'" }] }) });
    expect(await completeNarrative("key", "s", "u")).toBe("hi there");
  });

  it("does not strip mismatched quotes", async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ content: [{ type: "text", text: '"only one side' }] }) });
    expect(await completeNarrative("key", "s", "u")).toBe('"only one side');
  });

  it("trims leading/trailing whitespace", async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ content: [{ type: "text", text: "  spaced  " }] }) });
    expect(await completeNarrative("key", "s", "u")).toBe("spaced");
  });

  it("returns null for empty / whitespace-only responses", async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ content: [{ type: "text", text: "   " }] }) });
    expect(await completeNarrative("key", "s", "u")).toBeNull();
  });

  it("returns null when complete() returned null", async () => {
    fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    expect(await completeNarrative("key", "s", "u")).toBeNull();
  });
});

describe("model name exports", () => {
  it("uses the same model id for both narrator + zhipu aliases", () => {
    expect(NARRATOR_MODEL).toBe("glm-5");
    expect(ZHIPU_MODEL).toBe("glm-5");
  });
});
