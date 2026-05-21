import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { complete, completeNarrative, probeCompletion, NARRATOR_MODEL, ZHIPU_MODEL } from "../llm.js";
import { PROVIDER_ANTHROPIC, PROVIDER_OPENAI_COMPATIBLE } from "../llm-config.js";

const ANTHROPIC_CONFIG = {
  provider: PROVIDER_ANTHROPIC,
  baseUrl: "https://api.z.ai/api/anthropic",
  apiKey: "key",
  model: "glm-5",
};

const OPENAI_CONFIG = {
  provider: PROVIDER_OPENAI_COMPATIBLE,
  baseUrl: "https://proxy.example.com",
  apiKey: "bearer-key",
  model: "gpt-4o-mini",
};

// Build a fetch-Response-like stub. complete() reads via res.text() then
// JSON.parse, and also checks res.headers.get("content-length").
function okResponse(payload, { contentLength = null } = {}) {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    ok: true,
    headers: { get: (h) => (h.toLowerCase() === "content-length" ? (contentLength ?? String(raw.length)) : null) },
    text: async () => raw,
  };
}

function errorResponse(status) {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    text: async () => "",
  };
}

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
    expect(await complete({ ...ANTHROPIC_CONFIG, apiKey: null }, { system: "s", user: "u" })).toBeNull();
    expect(await complete({ ...ANTHROPIC_CONFIG, apiKey: "" }, { system: "s", user: "u" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("POSTs to the Anthropic endpoint with the right headers + body", async () => {
    fetch.mockResolvedValue(okResponse({ content: [{ type: "text", text: "hi" }] }));
    const result = await complete(ANTHROPIC_CONFIG, { system: "sys", user: "usr", maxTokens: 50, tag: "test" });
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

  it("POSTs to the OpenAI-compatible endpoint with bearer auth + chat shape", async () => {
    fetch.mockResolvedValue(okResponse({ choices: [{ message: { content: "hello" } }] }));
    const result = await complete(OPENAI_CONFIG, { system: "sys", user: "usr", maxTokens: 50 });
    expect(result).toBe("hello");

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://proxy.example.com/v1/chat/completions");
    expect(init.headers["Authorization"]).toBe("Bearer bearer-key");
    expect(init.headers["x-api-key"]).toBeUndefined();
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: "gpt-4o-mini",
      max_tokens: 50,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "usr" },
      ],
    });
  });

  it("strips trailing slashes from baseUrl", async () => {
    fetch.mockResolvedValue(okResponse({ content: [{ type: "text", text: "x" }] }));
    await complete(
      { ...ANTHROPIC_CONFIG, baseUrl: "https://api.z.ai/api/anthropic///" },
      { system: "s", user: "u" },
    );
    expect(fetch.mock.calls[0][0]).toBe("https://api.z.ai/api/anthropic/v1/messages");
  });

  it("returns null on non-2xx response (and warns)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetch.mockResolvedValue(errorResponse(503));
    expect(await complete(ANTHROPIC_CONFIG, { system: "s", user: "u", tag: "tag" })).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[tag] LLM (anthropic) returned 503"));
  });

  it("returns null on fetch throw (and warns)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetch.mockRejectedValue(new Error("network down"));
    expect(await complete(ANTHROPIC_CONFIG, { system: "s", user: "u" })).toBeNull();
  });

  it("returns null when Anthropic content array has no text block", async () => {
    fetch.mockResolvedValue(okResponse({ content: [{ type: "tool_use" }] }));
    expect(await complete(ANTHROPIC_CONFIG, { system: "s", user: "u" })).toBeNull();
  });

  it("returns null when Anthropic content is missing", async () => {
    fetch.mockResolvedValue(okResponse({}));
    expect(await complete(ANTHROPIC_CONFIG, { system: "s", user: "u" })).toBeNull();
  });

  it("returns null when OpenAI choices array is empty", async () => {
    fetch.mockResolvedValue(okResponse({ choices: [] }));
    expect(await complete(OPENAI_CONFIG, { system: "s", user: "u" })).toBeNull();
  });

  it("uses default max_tokens (220) when not specified", async () => {
    fetch.mockResolvedValue(okResponse({ content: [{ type: "text", text: "x" }] }));
    await complete(ANTHROPIC_CONFIG, { system: "s", user: "u" });
    expect(JSON.parse(fetch.mock.calls[0][1].body).max_tokens).toBe(220);
  });

  it("returns null when response Content-Length exceeds the cap", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetch.mockResolvedValue(
      okResponse({ content: [{ type: "text", text: "x" }] }, { contentLength: String(64 * 1024 + 1) }),
    );
    expect(await complete(ANTHROPIC_CONFIG, { system: "s", user: "u", tag: "tag" })).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("too large"));
  });

  it("returns null when actual response body exceeds the cap (no Content-Length)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Build a payload > 64 KB
    const huge = "x".repeat(70_000);
    fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      text: async () => huge,
    });
    expect(await complete(ANTHROPIC_CONFIG, { system: "s", user: "u" })).toBeNull();
  });

  it("returns null when response is not valid JSON", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      text: async () => "not json at all",
    });
    expect(await complete(ANTHROPIC_CONFIG, { system: "s", user: "u" })).toBeNull();
  });
});

describe("probeCompletion", () => {
  it("returns no_api_key when config is missing or has no key", async () => {
    expect(await probeCompletion(null, { system: "s", user: "u" })).toEqual({ ok: false, reason: "no_api_key" });
    expect(await probeCompletion({ ...ANTHROPIC_CONFIG, apiKey: "" }, { system: "s", user: "u" })).toEqual({
      ok: false,
      reason: "no_api_key",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns ok with the extracted text on success", async () => {
    fetch.mockResolvedValue(okResponse({ content: [{ type: "text", text: "hi" }] }));
    expect(await probeCompletion(ANTHROPIC_CONFIG, { system: "s", user: "u" })).toEqual({ ok: true, text: "hi" });
  });

  it("returns http_error with status + bodySnippet on non-2xx", async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => null },
      text: async () => '{"error":{"message":"bad key"}}',
    });
    const result = await probeCompletion(ANTHROPIC_CONFIG, { system: "s", user: "u" });
    expect(result).toEqual({
      ok: false,
      reason: "http_error",
      status: 401,
      bodySnippet: '{"error":{"message":"bad key"}}',
    });
  });

  it("clips bodySnippet on http_error to 500 chars", async () => {
    const huge = "x".repeat(2000);
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => null },
      text: async () => huge,
    });
    const result = await probeCompletion(ANTHROPIC_CONFIG, { system: "s", user: "u" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("http_error");
    expect(result.bodySnippet.length).toBe(500);
  });

  it("returns bad_json when the body isn't JSON", async () => {
    fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      text: async () => "<html>login page</html>",
    });
    expect(await probeCompletion(ANTHROPIC_CONFIG, { system: "s", user: "u" })).toEqual({
      ok: false,
      reason: "bad_json",
      bodySnippet: "<html>login page</html>",
    });
  });

  it("returns no_text_block when the provider returns JSON without text content", async () => {
    fetch.mockResolvedValue(okResponse({ content: [{ type: "tool_use" }] }));
    const result = await probeCompletion(ANTHROPIC_CONFIG, { system: "s", user: "u" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no_text_block");
    expect(typeof result.bodySnippet).toBe("string");
  });

  it("returns too_large when Content-Length exceeds the cap", async () => {
    fetch.mockResolvedValue(
      okResponse({ content: [{ type: "text", text: "x" }] }, { contentLength: String(64 * 1024 + 1) }),
    );
    expect(await probeCompletion(ANTHROPIC_CONFIG, { system: "s", user: "u" })).toEqual({
      ok: false,
      reason: "too_large",
      bytes: 64 * 1024 + 1,
    });
  });

  it("returns too_large when actual body exceeds the cap (no Content-Length)", async () => {
    const huge = "x".repeat(70_000);
    fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      text: async () => huge,
    });
    const result = await probeCompletion(ANTHROPIC_CONFIG, { system: "s", user: "u" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("too_large");
    expect(result.bytes).toBe(70_000);
  });

  it("returns timeout when fetch is aborted", async () => {
    fetch.mockImplementation(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });
    expect(await probeCompletion(ANTHROPIC_CONFIG, { system: "s", user: "u" })).toEqual({
      ok: false,
      reason: "timeout",
    });
  });

  it("returns network with the underlying error message on other throws", async () => {
    fetch.mockRejectedValue(new Error("ENOTFOUND litellm.example"));
    expect(await probeCompletion(ANTHROPIC_CONFIG, { system: "s", user: "u" })).toEqual({
      ok: false,
      reason: "network",
      message: "ENOTFOUND litellm.example",
    });
  });
});

describe("completeNarrative", () => {
  it("strips matching double quotes", async () => {
    fetch.mockResolvedValue(okResponse({ content: [{ type: "text", text: '"hello"' }] }));
    expect(await completeNarrative(ANTHROPIC_CONFIG, "s", "u")).toBe("hello");
  });

  it("strips matching single quotes", async () => {
    fetch.mockResolvedValue(okResponse({ content: [{ type: "text", text: "'hi there'" }] }));
    expect(await completeNarrative(ANTHROPIC_CONFIG, "s", "u")).toBe("hi there");
  });

  it("does not strip mismatched quotes", async () => {
    fetch.mockResolvedValue(okResponse({ content: [{ type: "text", text: '"only one side' }] }));
    expect(await completeNarrative(ANTHROPIC_CONFIG, "s", "u")).toBe('"only one side');
  });

  it("trims leading/trailing whitespace", async () => {
    fetch.mockResolvedValue(okResponse({ content: [{ type: "text", text: "  spaced  " }] }));
    expect(await completeNarrative(ANTHROPIC_CONFIG, "s", "u")).toBe("spaced");
  });

  it("returns null for empty / whitespace-only responses", async () => {
    fetch.mockResolvedValue(okResponse({ content: [{ type: "text", text: "   " }] }));
    expect(await completeNarrative(ANTHROPIC_CONFIG, "s", "u")).toBeNull();
  });

  it("returns null when complete() returned null", async () => {
    fetch.mockResolvedValue(errorResponse(500));
    expect(await completeNarrative(ANTHROPIC_CONFIG, "s", "u")).toBeNull();
  });
});

describe("model name exports", () => {
  it("uses the same model id for both narrator + zhipu aliases", () => {
    expect(NARRATOR_MODEL).toBe("glm-5");
    expect(ZHIPU_MODEL).toBe("glm-5");
  });
});
