import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../crypto.js", () => ({
  decryptToken: vi.fn(async (cipher, _key) => {
    if (cipher === "BAD") throw new Error("bad ciphertext");
    return `plain:${cipher}`;
  }),
}));

import { defaultLlmConfig, resolveLlmConfig } from "../llm-config.js";

function makeDb(row) {
  return {
    prepare() {
      return {
        bind() { return this; },
        first: () =>
          row instanceof Error ? Promise.reject(row) : Promise.resolve(row),
      };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("defaultLlmConfig", () => {
  it("returns the Zhipu defaults with the env key", () => {
    const cfg = defaultLlmConfig({ ZHIPU_API_KEY: "z-key" });
    expect(cfg).toEqual({
      provider: "anthropic",
      baseUrl: "https://api.z.ai/api/anthropic",
      model: "glm-5",
      apiKey: "z-key",
      source: "default",
    });
  });

  it("returns null apiKey when env key is missing", () => {
    expect(defaultLlmConfig({}).apiKey).toBeNull();
    expect(defaultLlmConfig(undefined).apiKey).toBeNull();
  });
});

describe("resolveLlmConfig", () => {
  it("returns default config when DB or orgId is missing", async () => {
    const env = { ZHIPU_API_KEY: "z-key" };
    expect((await resolveLlmConfig(env, null)).source).toBe("default");
    expect((await resolveLlmConfig({ ...env, DB: null }, 1)).source).toBe("default");
  });

  it("returns default config when no row exists for the org", async () => {
    const env = {
      DB: makeDb(null),
      ZHIPU_API_KEY: "z-key",
      ENCRYPTION_KEY: "0".repeat(64),
    };
    const cfg = await resolveLlmConfig(env, 7);
    expect(cfg.source).toBe("default");
  });

  it("returns default config (and logs) when DB query throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = {
      DB: makeDb(new Error("db down")),
      ZHIPU_API_KEY: "z-key",
      ENCRYPTION_KEY: "0".repeat(64),
    };
    const cfg = await resolveLlmConfig(env, 7);
    expect(cfg.source).toBe("default");
  });

  it("returns default config when ENCRYPTION_KEY is missing despite a row", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = {
      DB: makeDb({ provider: "anthropic", base_url: "x", encrypted_api_key: "c", model: "m" }),
      ZHIPU_API_KEY: "z-key",
    };
    const cfg = await resolveLlmConfig(env, 7);
    expect(cfg.source).toBe("default");
  });

  it("returns default config when decryption fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = {
      DB: makeDb({ provider: "anthropic", base_url: "x", encrypted_api_key: "BAD", model: "m" }),
      ZHIPU_API_KEY: "z-key",
      ENCRYPTION_KEY: "0".repeat(64),
    };
    const cfg = await resolveLlmConfig(env, 7);
    expect(cfg.source).toBe("default");
  });

  it("returns org override with decrypted key when configured", async () => {
    const env = {
      DB: makeDb({
        provider: "openai-compatible",
        base_url: "https://proxy.example.com",
        encrypted_api_key: "ENC",
        model: "gpt-4o-mini",
      }),
      ZHIPU_API_KEY: "z-key",
      ENCRYPTION_KEY: "0".repeat(64),
    };
    const cfg = await resolveLlmConfig(env, 7);
    expect(cfg).toEqual({
      provider: "openai-compatible",
      baseUrl: "https://proxy.example.com",
      apiKey: "plain:ENC",
      model: "gpt-4o-mini",
      source: "org",
    });
  });
});
