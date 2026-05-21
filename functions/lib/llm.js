// Provider-agnostic LLM client. Branches between two request/response shapes:
//   - Anthropic Messages API (default; also used by Zhipu's compat endpoint)
//   - OpenAI chat-completions (any OpenAI-compatible endpoint, including
//     LiteLLM proxies, Ollama, vLLM, etc.)
//
// Configs come from llm-config.js — never call this with a raw env key; the
// resolver handles default fallback so test mocks stay simple.

import { PROVIDER_ANTHROPIC, PROVIDER_OPENAI_COMPATIBLE } from "./llm-config";
import { sleep } from "./pacing";

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 220;
const TIMEOUT_MS = 30_000;

// Retry only transient conditions. 4xx auth / model-name errors should
// surface immediately so the matcher/narrator don't burn 3× the tokens
// on a config that's broken anyway.
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 8000;

function isRetriable(result) {
  if (result.ok) return false;
  if (result.reason === "timeout") return true;
  if (result.reason === "network") return true;
  if (result.reason === "http_error") {
    return result.status === 429 || result.status >= 500;
  }
  return false;
}

// Full-jitter exponential backoff: random in [0, base * 2^attempt],
// capped at RETRY_MAX_DELAY_MS. Jitter avoids the thundering-herd
// case where every queued post retries at the same beat after a 429.
function backoffDelay(attempt) {
  const ceiling = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
  return Math.floor(Math.random() * ceiling);
}

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
 * One-shot text completion with retry-on-transient. Returns the raw
 * assistant text, or null on persistent failure. The caller decides what
 * to do with null — surface it, skip, or log to op_failures. Diagnostic
 * details land in console.warn so observability/op_failures stays
 * unchanged.
 *
 * Retries 429 / 5xx / network / timeout with exponential backoff + jitter.
 * Does NOT retry: 4xx (other than 429), bad_json, no_text_block,
 * no_api_key, too_large — those are config/permanent errors, not transient.
 */
export async function complete(config, opts) {
  const tag = opts?.tag ?? "llm";
  let lastResult;
  for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
    const result = await probeCompletion(config, opts);
    if (result.ok) return result.text;
    lastResult = result;
    const isLast = attempt === RETRY_MAX_ATTEMPTS - 1;
    if (!isRetriable(result) || isLast) break;
    const delay = backoffDelay(attempt);
    const detail = result.reason === "http_error"
      ? `${result.reason} ${result.status}`
      : result.reason;
    console.warn(
      `[${tag}] LLM transient failure (${detail}); retry ${attempt + 1}/${RETRY_MAX_ATTEMPTS - 1} in ${delay}ms`,
    );
    await sleep(delay);
  }
  switch (lastResult.reason) {
    case "no_api_key":
      return null; // historic: silent null for missing key
    case "http_error":
      console.warn(`[${tag}] LLM (${config?.provider}) returned ${lastResult.status}`);
      return null;
    case "too_large":
      console.warn(`[${tag}] LLM response too large (${lastResult.bytes} bytes)`);
      return null;
    case "bad_json":
      console.warn(`[${tag}] LLM response was not JSON`);
      return null;
    case "timeout":
      console.warn(`[${tag}] LLM request aborted after ${TIMEOUT_MS}ms`);
      return null;
    case "network":
      console.warn(`[${tag}] LLM request failed: ${lastResult.message}`);
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
