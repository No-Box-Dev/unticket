// Zhipu Anthropic-compatible client.
// Endpoint: POST https://api.z.ai/api/anthropic/v1/messages
// Headers: x-api-key + anthropic-version: 2023-06-01. Model: glm-5.

const ENDPOINT = "https://api.z.ai/api/anthropic/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "glm-5";
const DEFAULT_MAX_TOKENS = 220;
const TIMEOUT_MS = 30_000;

export const NARRATOR_MODEL = MODEL;
export const ZHIPU_MODEL = MODEL;

// Generic Zhipu completion. Returns raw text or null on failure. Callers
// that need post-processing (quote stripping for narratives, JSON parsing
// for the feature matcher) handle it themselves.
export async function complete(apiKey, { system, user, maxTokens = DEFAULT_MAX_TOKENS, tag = "llm" }) {
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[${tag}] Zhipu returned ${res.status}`);
      return null;
    }
    const body = await res.json();
    return (body.content ?? []).find((b) => b?.type === "text")?.text ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.name === "AbortError") {
      console.warn(`[${tag}] Zhipu request aborted after ${TIMEOUT_MS}ms`);
    } else {
      console.warn(`[${tag}] Zhipu request failed: ${msg}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function completeNarrative(apiKey, system, user) {
  const text = await complete(apiKey, { system, user, tag: "narrator" });
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
