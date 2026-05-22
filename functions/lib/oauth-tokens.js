// Persistence + refresh helpers for GitHub App user-to-server tokens.
//
// The middleware only deals with the *current* access token. When that token
// expires (default 8 hours) the client calls /api/auth/refresh with the
// expired token; we hash it, find the row, and use the stored refresh token
// to ask GitHub for a new pair. Both tokens rotate on every refresh.

import { encryptToken, decryptToken } from "./crypto";

const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

/** Hash a token with SHA-256 — same function the middleware uses for lookups. */
export async function hashAccessToken(token) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function expiresAtIso(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Persist (or rotate) an OAuth token pair. `oldAccessHash` lets refresh atomically
 * replace the previous row in one statement so the pre-rotation hash can't sit
 * around as a usable lookup key.
 */
export async function saveOAuthTokens(db, {
  accessToken,
  refreshToken,
  expiresInSec,
  refreshTokenExpiresInSec,
  githubLogin,
  encryptionKey,
  oldAccessHash,
}) {
  if (!accessToken || !githubLogin || !encryptionKey) return;
  const newHash = await hashAccessToken(accessToken);
  const encryptedRefresh = refreshToken
    ? await encryptToken(refreshToken, encryptionKey)
    : null;
  const accessExpiresAt = expiresAtIso(Number(expiresInSec));
  const refreshExpiresAt = expiresAtIso(Number(refreshTokenExpiresInSec));

  if (oldAccessHash) {
    // Atomic rotate: same row, new hash + new tokens. UPDATE rather than
    // DELETE+INSERT so a concurrent reader can't see a window with no row.
    const result = await db.prepare(
      `UPDATE oauth_tokens
          SET access_token_sha256 = ?,
              encrypted_refresh_token = COALESCE(?, encrypted_refresh_token),
              access_token_expires_at = ?,
              refresh_token_expires_at = COALESCE(?, refresh_token_expires_at),
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE access_token_sha256 = ?`,
    )
      .bind(newHash, encryptedRefresh, accessExpiresAt, refreshExpiresAt, oldAccessHash)
      .run();
    if (result.meta?.changes && result.meta.changes > 0) return;
    // Old hash was already rotated away by another tab — fall through and
    // insert a fresh row.
  }

  await db
    .prepare(
      `INSERT INTO oauth_tokens
         (access_token_sha256, github_login, encrypted_refresh_token,
          access_token_expires_at, refresh_token_expires_at,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
       ON CONFLICT(access_token_sha256) DO UPDATE SET
         encrypted_refresh_token = COALESCE(excluded.encrypted_refresh_token, oauth_tokens.encrypted_refresh_token),
         access_token_expires_at = excluded.access_token_expires_at,
         refresh_token_expires_at = COALESCE(excluded.refresh_token_expires_at, oauth_tokens.refresh_token_expires_at),
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
    )
    .bind(newHash, githubLogin, encryptedRefresh, accessExpiresAt, refreshExpiresAt)
    .run();
}

export async function findOAuthRow(db, accessToken) {
  const hash = await hashAccessToken(accessToken);
  const row = await db
    .prepare(
      `SELECT id, access_token_sha256, github_login, encrypted_refresh_token,
              refresh_token_expires_at
         FROM oauth_tokens
        WHERE access_token_sha256 = ?`,
    )
    .bind(hash)
    .first();
  return row ? { ...row, hash } : null;
}

export async function deleteOAuthRow(db, accessTokenHash) {
  await db
    .prepare("DELETE FROM oauth_tokens WHERE access_token_sha256 = ?")
    .bind(accessTokenHash)
    .run();
}

/**
 * Exchange a refresh token for a new access/refresh pair. Throws on transport
 * failure; returns `{ error }` shape when GitHub returns a refresh error
 * (typically `bad_refresh_token` after the token was revoked or rotated).
 */
export async function refreshWithGitHub({ clientId, clientSecret, refreshToken }) {
  const res = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    return { transportError: `GitHub refresh returned ${res.status}` };
  }
  const data = await res.json().catch(() => null);
  if (!data) return { transportError: "GitHub refresh returned non-JSON" };
  if (data.error) return { error: data.error, errorDescription: data.error_description };
  if (!data.access_token) return { error: "missing_access_token" };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresInSec: Number(data.expires_in) || null,
    refreshTokenExpiresInSec: Number(data.refresh_token_expires_in) || null,
  };
}

export { decryptToken };
