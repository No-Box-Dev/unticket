// Per-org LLM provider override.
//
// GET    /api/llm-settings  — returns the current config (key replaced by a
//                              short plaintext prefix like "sk-ant…" so admins
//                              can tell which key is stored without us echoing
//                              the secret). Pre-prefix rows render "••••".
//                              Returns `{ configured: false }` when no override
//                              is set.
// PUT    /api/llm-settings  — validates the submitted config by issuing a
//                              one-shot `complete()` call. If the LLM responds,
//                              we encrypt the key and upsert the row. If it
//                              fails, we 422 with the failure reason so the
//                              user can fix their input without saving a bad
//                              key. ENCRYPTION_KEY is required.
// DELETE /api/llm-settings  — removes the row. Narrator + matcher then fall
//                              back to env.ZHIPU_API_KEY automatically.
//
// Admin-gated. Everything below relies on `context.data.isAdmin` from the
// `_middleware.js` bootstrap path.

import { getCtx, jsonResponse, errorResponse } from "../lib/db";
import { encryptToken, decryptToken } from "../lib/crypto";
import { probeCompletion } from "../lib/llm";
import {
  PROVIDER_ANTHROPIC,
  PROVIDER_OPENAI_COMPATIBLE,
} from "../lib/llm-config";

const VALID_PROVIDERS = new Set([PROVIDER_ANTHROPIC, PROVIDER_OPENAI_COMPATIBLE]);

// Per-isolate rate limit on PUT — the validation probe makes an outbound
// fetch with admin-supplied (url, key), so we don't want a compromised admin
// token to be able to bulk-probe credentials. Cloudflare reuses isolates for
// warm invocations so this works as a soft cap; we accept that a cold-start
// fan-out across many isolates would let a few extra probes through.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const putAttempts = new Map();

function checkAndRecordPutAttempt(orgId) {
  const now = Date.now();
  const recent = (putAttempts.get(orgId) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  if (recent.length >= RATE_LIMIT_MAX) return false;
  recent.push(now);
  putAttempts.set(orgId, recent);

  // GC idle orgs occasionally — keeps the Map from growing unbounded across
  // warm-isolate lifetime without paying a sweep on every request.
  if (Math.random() < 0.01) {
    for (const [k, v] of putAttempts) {
      if (!v.some((t) => now - t < RATE_LIMIT_WINDOW_MS)) putAttempts.delete(k);
    }
  }
  return true;
}

// How many leading chars of the API key we store in plaintext as `key_prefix`.
// Enough to disambiguate provider/account families (sk-ant…, sk-pro…, sk-svc…)
// without giving away meaningful entropy from the secret portion.
const KEY_PREFIX_CHARS = 6;

function extractKeyPrefix(key) {
  if (typeof key !== "string") return null;
  const trimmed = key.trim();
  if (trimmed.length < KEY_PREFIX_CHARS) return null;
  return trimmed.slice(0, KEY_PREFIX_CHARS);
}

function keyDisplayMask(prefix) {
  return prefix ? `${prefix}…` : "••••";
}

// Turn a probeCompletion() diagnostic into a user-facing message. The body
// snippet often contains the provider's actual error JSON (LiteLLM/OpenAI
// shape: { error: { message: ... } }); pull that out when it's there so the
// admin sees "Authentication Error: ..." instead of the wrapped JSON.
function extractProviderMessage(snippet) {
  if (!snippet) return "";
  try {
    const parsed = JSON.parse(snippet);
    const msg = parsed?.error?.message ?? parsed?.error ?? parsed?.message;
    if (typeof msg === "string" && msg.trim()) return msg.trim().slice(0, 300);
  } catch { /* not JSON — fall through */ }
  return snippet.slice(0, 300);
}

export function formatProbeFailure(probe) {
  switch (probe.reason) {
    case "no_api_key":
      return "API key is required.";
    case "http_error": {
      const provider = extractProviderMessage(probe.bodySnippet);
      const suffix = provider ? ` Provider said: ${provider}` : "";
      if (probe.status === 401 || probe.status === 403) {
        return `Provider rejected the API key (HTTP ${probe.status}). The key is invalid, revoked, or lacks access to this model.${suffix}`;
      }
      if (probe.status === 404) {
        return `Endpoint not found (HTTP 404). Check the Base URL — for LiteLLM / OpenAI-compatible proxies, use the proxy root (no /v1).${suffix}`;
      }
      if (probe.status === 400 || probe.status === 422) {
        return `Provider rejected the request (HTTP ${probe.status}). Common cause: model name is not configured for this endpoint.${suffix}`;
      }
      if (probe.status === 429) {
        return `Provider rate-limited the validation call (HTTP 429). Try again in a moment.${suffix}`;
      }
      if (probe.status >= 500) {
        return `Provider returned HTTP ${probe.status} — likely a provider-side outage.${suffix}`;
      }
      return `Provider returned HTTP ${probe.status}.${suffix}`;
    }
    case "bad_json":
      return `Provider responded with non-JSON content. The Base URL probably points at a login / HTML page rather than the API. First 200 chars: ${(probe.bodySnippet || "").slice(0, 200)}`;
    case "no_text_block": {
      const snippet = (probe.bodySnippet || "").slice(0, 300);
      const suffix = snippet ? ` Provider returned: ${snippet}` : "";
      return `Provider responded but with no text content. Common causes: the model isn't a chat / text-output model, or it's a reasoning model that consumed the token budget before producing visible output (try a larger model or a non-reasoning variant).${suffix}`;
    }
    case "too_large":
      return `Provider response exceeded the ${64} KB cap (${probe.bytes} bytes). This endpoint is probably not OpenAI-/Anthropic-compatible.`;
    case "timeout":
      return "Validation call timed out after 30s. The endpoint is unreachable or overloaded.";
    case "network":
      return `Couldn't reach the Base URL: ${probe.message}. Check spelling and that the host is reachable from the public internet (private / loopback addresses are blocked).`;
    default:
      return "Validation call failed — check provider, base URL, model name, and API key.";
  }
}

// Block hostnames that resolve into the worker's local network or
// link-local / metadata ranges. We can't fully defend against DNS rebinding
// from a CF Worker (no pre-resolve API short of `connect()`), but blocking
// literal IPs + common local names kills the easy variants.
export function isPrivateHostname(hostname) {
  if (!hostname) return true;
  // URL.hostname wraps IPv6 in brackets ("[::1]"); strip them so the literal
  // comparisons below work against the raw address.
  let lower = hostname.toLowerCase();
  if (lower.startsWith("[") && lower.endsWith("]")) {
    lower = lower.slice(1, -1);
  }

  if (lower === "localhost") return true;
  if (
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal")
  ) {
    return true;
  }

  const v4 = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = v4.slice(1, 3).map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local incl. cloud IMDS
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  if (lower.includes(":")) {
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (lower.startsWith("fe80:")) return true; // link-local
    if (lower.startsWith("::ffff:")) return true; // IPv4-mapped
    return false;
  }

  return false;
}

export async function onRequestGet(context) {
  const { orgId, isAdmin } = getCtx(context);
  if (!orgId) return errorResponse("Missing org context", 400);
  if (!isAdmin) return errorResponse("Admin required", 403);

  const row = await context.env.DB
    .prepare(
      `SELECT provider, base_url, model, key_prefix, updated_at
         FROM llm_settings WHERE org_id = ?`,
    )
    .bind(orgId)
    .first();

  if (!row) return jsonResponse({ configured: false });

  return jsonResponse({
    configured: true,
    provider: row.provider,
    baseUrl: row.base_url,
    model: row.model,
    keyMask: keyDisplayMask(row.key_prefix),
    updatedAt: row.updated_at,
  });
}

export async function onRequestPut(context) {
  const { orgId, isAdmin } = getCtx(context);
  if (!orgId) return errorResponse("Missing org context", 400);
  if (!isAdmin) return errorResponse("Admin required", 403);

  if (!checkAndRecordPutAttempt(orgId)) {
    return errorResponse(
      `Too many save attempts — try again in a minute (max ${RATE_LIMIT_MAX}/min).`,
      429,
    );
  }

  const encryptionKey = context.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    return errorResponse("Server missing ENCRYPTION_KEY", 500);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return errorResponse("Body must be JSON", 400);
  }

  const provider = String(body?.provider ?? "").trim();
  const baseUrl = String(body?.baseUrl ?? "").trim();
  const apiKey = String(body?.apiKey ?? "").trim();
  const model = String(body?.model ?? "").trim();

  if (!VALID_PROVIDERS.has(provider)) {
    return errorResponse(`Invalid provider. Use one of: ${[...VALID_PROVIDERS].join(", ")}`, 422);
  }

  // HTTPS only — the request body carries the API key in Authorization /
  // x-api-key headers, so plaintext HTTP would leak it on the wire.
  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    return errorResponse("baseUrl must be a valid URL", 422);
  }
  if (parsedUrl.protocol !== "https:") {
    return errorResponse("baseUrl must use https://", 422);
  }
  if (isPrivateHostname(parsedUrl.hostname)) {
    return errorResponse(
      "baseUrl must be a public hostname (private / link-local / loopback addresses are blocked)",
      422,
    );
  }

  if (!model) {
    return errorResponse("model is required", 422);
  }

  // When the admin leaves the API key blank on an existing config, reuse the
  // stored key. Lets them swap models or base URLs without re-pasting the
  // secret every time. If no row exists yet, the key is genuinely required.
  let effectiveApiKey = apiKey;
  let reuseStoredKey = false;
  if (!effectiveApiKey) {
    const existing = await context.env.DB
      .prepare("SELECT encrypted_api_key FROM llm_settings WHERE org_id = ?")
      .bind(orgId)
      .first();
    if (!existing) {
      return errorResponse("apiKey is required", 422);
    }
    try {
      effectiveApiKey = await decryptToken(existing.encrypted_api_key, encryptionKey);
    } catch {
      return errorResponse(
        "Stored API key could not be decrypted (ENCRYPTION_KEY may have changed). Re-enter the key.",
        422,
      );
    }
    reuseStoredKey = true;
  }

  // Validate by issuing a real (cheap) completion. If the provider rejects
  // the key, the wrong base URL is configured, or the model name is invalid,
  // the probe returns a diagnostic and we refuse to save — surfaces the real
  // reason (401, 404, model-not-found, etc.) instead of a generic message.
  const probeConfig = { provider, baseUrl, apiKey: effectiveApiKey, model };
  // Effectively uncapped — reasoning models (Gemini 2.5, Claude extended
  // thinking, o-series) spend tokens internally before producing visible
  // output, and there's no way to predict how many. The 64 KB response cap
  // in llm.js bounds the actual transport size, so we don't need a tight
  // max_tokens here. Anthropic requires the field, so we send a high value
  // rather than omitting it.
  const probe = await probeCompletion(probeConfig, {
    system: "Reply with the single word: ok",
    user: "ping",
    maxTokens: 4096,
    tag: "llm-settings-validate",
  });
  if (!probe.ok) {
    return errorResponse(formatProbeFailure(probe), 422);
  }

  const encryptedKey = await encryptToken(effectiveApiKey, encryptionKey);
  const keyPrefix = extractKeyPrefix(effectiveApiKey);
  await context.env.DB
    .prepare(
      `INSERT INTO llm_settings (org_id, provider, base_url, encrypted_api_key, model, key_prefix, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
       ON CONFLICT(org_id) DO UPDATE SET
         provider = excluded.provider,
         base_url = excluded.base_url,
         encrypted_api_key = excluded.encrypted_api_key,
         model = excluded.model,
         key_prefix = excluded.key_prefix,
         updated_at = excluded.updated_at`,
    )
    .bind(orgId, provider, baseUrl, encryptedKey, model, keyPrefix)
    .run();

  return jsonResponse({
    configured: true,
    provider,
    baseUrl,
    model,
    keyMask: keyDisplayMask(keyPrefix),
    keyReused: reuseStoredKey,
  });
}

export async function onRequestDelete(context) {
  const { orgId, isAdmin } = getCtx(context);
  if (!orgId) return errorResponse("Missing org context", 400);
  if (!isAdmin) return errorResponse("Admin required", 403);

  await context.env.DB
    .prepare("DELETE FROM llm_settings WHERE org_id = ?")
    .bind(orgId)
    .run();

  return jsonResponse({ configured: false });
}
