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

function maskKey(key) {
  if (typeof key !== "string" || key.length < 4) return "••••";
  return `••••${key.slice(-4)}`;
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
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
    return errorResponse("baseUrl must be an http(s) URL", 422);
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
