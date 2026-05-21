import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { complete, completeNarrative, NARRATOR_MODEL, ZHIPU_MODEL } from "../llm.js";
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
