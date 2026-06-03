// Per-org LLM configuration resolver.
//
// resolveLlmConfig() returns the LLM endpoint the narrator and matcher should
// use for this org. Org overrides win; otherwise we fall back to the Zhipu
// Anthropic-compatible endpoint with env.ZHIPU_API_KEY (the historical
// default that every caller used before this feature shipped).

import { decryptToken } from "./crypto";
import { isPrivateHostname } from "./private-host";

export const PROVIDER_ANTHROPIC = "anthropic";
export const PROVIDER_OPENAI_COMPATIBLE = "openai-compatible";

const DEFAULT_CONFIG = Object.freeze({
  provider: PROVIDER_ANTHROPIC,
  baseUrl: "https://api.z.ai/api/anthropic",
  model: "glm-5",
});

export function defaultLlmConfig(env) {
  return {
    ...DEFAULT_CONFIG,
    apiKey: env?.ZHIPU_API_KEY ?? null,
    source: "default",
  };
}

/**
 * Look up the org's LLM override (if any). Decrypts the stored API key in
 * memory only — never returned to the caller in any other path. Returns the
 * default Zhipu config when no override is configured OR when decryption
 * fails (a corrupt row shouldn't take down the whole feed; the failure is
 * surfaced when the caller actually tries to make a request).
 */
export async function resolveLlmConfig(env, orgId) {
  const db = env?.DB;
  if (!db || !orgId) return defaultLlmConfig(env);

  const row = await db
    .prepare(
      `SELECT provider, base_url, encrypted_api_key, model
         FROM llm_settings WHERE org_id = ?`,
    )
    .bind(orgId)
    .first()
    .catch(() => null);
  if (!row) return defaultLlmConfig(env);

  // Re-validate the stored base_url at request time, not just when it was saved.
  // A save-time-only check (api/llm-settings.ts) is defeated by DNS rebinding or
  // an admin re-pointing the host after saving; without this, the narrator's
  // fetch would hit internal/metadata addresses with the org's key attached
  // (SSRF). Fail safe to the default endpoint if it's private or unparseable.
  let host = null;
  try {
    host = new URL(row.base_url).hostname;
  } catch {
    host = null;
  }
  if (isPrivateHostname(host)) {
    console.error("[llm-config] org base_url is private or unparseable; using default endpoint");
    return defaultLlmConfig(env);
  }

  const encryptionKey = env?.ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.error("[llm-config] ENCRYPTION_KEY missing while llm_settings exists");
    return defaultLlmConfig(env);
  }
  let apiKey;
  try {
    apiKey = await decryptToken(row.encrypted_api_key, encryptionKey);
  } catch (err) {
    console.error("[llm-config] decrypt failed:", err?.message ?? err);
    return defaultLlmConfig(env);
  }

  return {
    provider: row.provider,
    baseUrl: row.base_url,
    apiKey,
    model: row.model,
    source: "org",
  };
}
