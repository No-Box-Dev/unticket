// Provider-agnostic LLM client. Branches between two request/response shapes:
//   - Anthropic Messages API (default; also used by Zhipu's compat endpoint)
//   - OpenAI chat-completions (any OpenAI-compatible endpoint, including
//     LiteLLM proxies, Ollama, vLLM, etc.)
//
// Configs come from llm-config.js — never call this with a raw env key; the
// resolver handles default fallback so test mocks stay simple.

import { PROVIDER_ANTHROPIC, PROVIDER_OPENAI_COMPATIBLE } from "./llm-config";

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 220;
const TIMEOUT_MS = 30_000;

// Cap the response body we'll buffer from a user-supplied LLM endpoint.
// max_tokens caps the *content*, but a hostile endpoint could send a giant
// JSON blob and OOM the worker (128 MB limit). 64 KB is ~10× the longest
// legitimate response we expect (matcher uses max_tokens=800).
const MAX_RESPONSE_BYTES = 64 * 1024;

// Historical names kept so test mocks and callers that just want a label
// don't need a config lookup.
export const NARRATOR_MODEL = "glm-5";
export const ZHIPU_MODEL = "glm-5";

function buildRequest(config, { system, user, maxTokens }) {
  const base = stripTrailingSlash(config.baseUrl);
  if (config.provider === PROVIDER_OPENAI_COMPATIBLE) {
    return {
      url: `${base}/v1/chat/completions`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      extract: (json) => json?.choices?.[0]?.message?.content ?? null,
    };
  }
  // Default = Anthropic shape (covers Zhipu's compat endpoint too).
  return {
    url: `${base}/v1/messages`,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
    extract: (json) =>
      (json?.content ?? []).find((b) => b?.type === "text")?.text ?? null,
  };
}

/**
 * One-shot text completion. Returns the raw assistant text, or null on any
 * failure (no key, HTTP error, timeout, malformed JSON). The caller decides
 * what to do with null — surface it, skip, or log to op_failures.
 */
export async function complete(config, { system, user, maxTokens = DEFAULT_MAX_TOKENS, tag = "llm" }) {
  if (!config?.apiKey) return null;

  const req = buildRequest(config, { system, user, maxTokens });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[${tag}] LLM (${config.provider}) returned ${res.status}`);
      return null;
    }
    const contentLength = Number(res.headers.get("content-length") ?? "0");
    if (contentLength > MAX_RESPONSE_BYTES) {
      console.warn(`[${tag}] LLM response too large (${contentLength} bytes)`);
      return null;
    }
    const raw = await res.text();
    if (raw.length > MAX_RESPONSE_BYTES) {
      console.warn(`[${tag}] LLM response too large (${raw.length} bytes)`);
      return null;
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      console.warn(`[${tag}] LLM response was not JSON`);
      return null;
    }
    return req.extract(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.name === "AbortError") {
      console.warn(`[${tag}] LLM request aborted after ${TIMEOUT_MS}ms`);
    } else {
      console.warn(`[${tag}] LLM request failed: ${msg}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function completeNarrative(config, system, user) {
  const text = await complete(config, { system, user, tag: "narrator" });
  return sanitizeNarrative(text);
}

function sanitizeNarrative(text) {
  if (typeof text !== "string") return null;
  let t = text.trim();
  if (!t) return null;
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  return t || null;
}

function stripTrailingSlash(url) {
  return typeof url === "string" ? url.replace(/\/+$/, "") : url;
}
