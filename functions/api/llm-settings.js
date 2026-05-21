// Per-org LLM provider override.
//
// GET    /api/llm-settings  — returns the current config (key replaced by a
//                              masked tail like "••••abcd" so we never echo
//                              the secret back to the browser). Returns
//                              `{ configured: false }` when no override is set.
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
import { encryptToken } from "../lib/crypto";
import { complete } from "../lib/llm";
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

function maskKey(key) {
  if (typeof key !== "string" || key.length < 4) return "••••";
  return `••••${key.slice(-4)}`;
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
      `SELECT provider, base_url, model, updated_at
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
    keyMask: "••••",
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

  if (!apiKey) {
    return errorResponse("apiKey is required", 422);
  }
  if (!model) {
    return errorResponse("model is required", 422);
  }

  // Validate by issuing a real (cheap) completion. If the provider rejects
  // the key, the wrong base URL is configured, or the model name is invalid,
  // `complete()` returns null and we refuse to save — saves users from
  // discovering broken config later when an event tries to narrate.
  const probeConfig = { provider, baseUrl, apiKey, model };
  const probe = await complete(probeConfig, {
    system: "Reply with the single word: ok",
    user: "ping",
    maxTokens: 8,
    tag: "llm-settings-validate",
  });
  if (probe == null) {
    return errorResponse(
      "Validation call failed — check provider, base URL, model name, and API key.",
      422,
    );
  }

  const encryptedKey = await encryptToken(apiKey, encryptionKey);
  await context.env.DB
    .prepare(
      `INSERT INTO llm_settings (org_id, provider, base_url, encrypted_api_key, model, updated_at)
       VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
       ON CONFLICT(org_id) DO UPDATE SET
         provider = excluded.provider,
         base_url = excluded.base_url,
         encrypted_api_key = excluded.encrypted_api_key,
         model = excluded.model,
         updated_at = excluded.updated_at`,
    )
    .bind(orgId, provider, baseUrl, encryptedKey, model)
    .run();

  return jsonResponse({
    configured: true,
    provider,
    baseUrl,
    model,
    keyMask: maskKey(apiKey),
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
