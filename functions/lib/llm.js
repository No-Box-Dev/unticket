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
 * One-shot text completion with diagnostic info. Returns a discriminated
 * result:
 *   { ok: true, text }
 *   { ok: false, reason: "no_api_key" }
 *   { ok: false, reason: "http_error",   status, bodySnippet }
 *   { ok: false, reason: "no_text_block", bodySnippet }
 *   { ok: false, reason: "bad_json",     bodySnippet }
 *   { ok: false, reason: "too_large",    bytes }
 *   { ok: false, reason: "timeout" }
 *   { ok: false, reason: "network",      message }
 *
 * Used by the LLM-settings validation probe so admins see WHY their config
 * was rejected. Production callers should keep using `complete()` (below),
 * which drops the diagnostic into a warn log and returns null.
 */
export async function probeCompletion(config, { system, user, maxTokens = DEFAULT_MAX_TOKENS, tag = "llm" }) {
  if (!config?.apiKey) return { ok: false, reason: "no_api_key" };

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
      let bodySnippet = "";
      try { bodySnippet = (await res.text()).slice(0, 500); } catch { /* body unreadable */ }
      return { ok: false, reason: "http_error", status: res.status, bodySnippet };
    }
    const contentLength = Number(res.headers.get("content-length") ?? "0");
    if (contentLength > MAX_RESPONSE_BYTES) {
      return { ok: false, reason: "too_large", bytes: contentLength };
    }
    const raw = await res.text();
    if (raw.length > MAX_RESPONSE_BYTES) {
      return { ok: false, reason: "too_large", bytes: raw.length };
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "bad_json", bodySnippet: raw.slice(0, 500) };
    }
    const text = req.extract(body);
    if (typeof text !== "string" || text.length === 0) {
      return { ok: false, reason: "no_text_block", bodySnippet: raw.slice(0, 500) };
    }
    return { ok: true, text };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "network", message: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
    void tag; // tag is consumed by complete() for log labelling; unused here
  }
}

/**
 * One-shot text completion. Returns the raw assistant text, or null on any
 * failure (no key, HTTP error, timeout, malformed JSON). The caller decides
 * what to do with null — surface it, skip, or log to op_failures. Diagnostic
 * details land in console.warn so observability/op_failures stays unchanged.
 */
export async function complete(config, opts) {
  const tag = opts?.tag ?? "llm";
  const result = await probeCompletion(config, opts);
  if (result.ok) return result.text;
  switch (result.reason) {
    case "no_api_key":
      return null; // historic: silent null for missing key
    case "http_error":
      console.warn(`[${tag}] LLM (${config?.provider}) returned ${result.status}`);
      return null;
    case "too_large":
      console.warn(`[${tag}] LLM response too large (${result.bytes} bytes)`);
      return null;
    case "bad_json":
      console.warn(`[${tag}] LLM response was not JSON`);
      return null;
    case "timeout":
      console.warn(`[${tag}] LLM request aborted after ${TIMEOUT_MS}ms`);
      return null;
    case "network":
      console.warn(`[${tag}] LLM request failed: ${result.message}`);
      return null;
    case "no_text_block":
      return null; // historic: silent null when content was returned without text
    default:
      return null;
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
