// POST /api/auth/refresh
// Body: { token: <expired-or-soon-to-expire GitHub access token> }
//
// Middleware skips /api/auth/* so this endpoint runs without a valid Bearer.
// The client identifies its session by handing back the (possibly already
// rejected) access token; we hash it and look up the matching refresh token
// row, then ask GitHub for a fresh pair. Both tokens rotate.
//
// Returns { token } on success or 401 on any failure — the client should
// treat a failure as a hard logout.

import { z } from "zod";
import {
  findOAuthRow,
  deleteOAuthRow,
  saveOAuthTokens,
  refreshWithGitHub,
  decryptToken,
} from "../../lib/oauth-tokens";
import { validate } from "../../lib/validate";

interface Env {
  DB: D1Database;
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_CLIENT_SECRET?: string;
  ENCRYPTION_KEY?: string;
  [k: string]: unknown;
}

interface Ctx {
  env: Env;
  request: Request;
}

// Body schema — replaces the hand-rolled `typeof token === "string"` check.
// `.min(1)` mirrors the original truthiness guard (empty string was rejected).
const RefreshBody = z.object({
  token: z.string().min(1, "Missing access token"),
});

export async function onRequestPost(context: Ctx): Promise<Response> {
  const clientId = context.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = context.env.GITHUB_APP_CLIENT_SECRET;
  const encryptionKey = context.env.ENCRYPTION_KEY;
  if (!clientId || !clientSecret || !encryptionKey) {
    console.error("[auth/refresh] missing GITHUB_APP_CLIENT_ID / CLIENT_SECRET / ENCRYPTION_KEY");
    return jsonError("Refresh not configured", 500);
  }

  let rawBody: unknown;
  try {
    rawBody = await context.request.json();
  } catch {
    return jsonError("Invalid request body", 400);
  }
  const parsed = validate(RefreshBody, rawBody);
  if (!parsed.ok) return parsed.response;
  const expiredToken = parsed.data.token;

  const row = await findOAuthRow(context.env.DB, expiredToken);
  if (!row || !row.encrypted_refresh_token) {
    return jsonError("Unknown session", 401);
  }

  // Refresh token TTL is 6 months. Anything past that and GitHub will reject
  // the call anyway — surface the same 401 the client uses for "log back in"
  // without round-tripping.
  if (row.refresh_token_expires_at) {
    const expiresAt = new Date(row.refresh_token_expires_at).getTime();
    if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
      await deleteOAuthRow(context.env.DB, row.hash);
      return jsonError("Refresh token expired", 401);
    }
  }

  let refreshToken: string;
  try {
    refreshToken = await decryptToken(row.encrypted_refresh_token, encryptionKey);
  } catch (err) {
    console.error("[auth/refresh] decryptToken failed:", (err as Error)?.message ?? err);
    await deleteOAuthRow(context.env.DB, row.hash);
    return jsonError("Session decrypt failed", 401);
  }

  const result = await refreshWithGitHub({ clientId, clientSecret, refreshToken });
  if (result.transportError) {
    // Transient — don't delete the row, let the client try again later.
    console.error("[auth/refresh]", result.transportError);
    return jsonError("Refresh temporarily unavailable", 503);
  }
  if (result.error) {
    // GitHub said the refresh token is no good. Forget the row so the
    // attacker (if any) can't keep poking the same key.
    console.error("[auth/refresh] github error:", result.error, result.errorDescription);
    await deleteOAuthRow(context.env.DB, row.hash);
    return jsonError("Refresh rejected", 401);
  }

  try {
    await saveOAuthTokens(context.env.DB, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresInSec: result.expiresInSec,
      refreshTokenExpiresInSec: result.refreshTokenExpiresInSec,
      githubLogin: row.github_login,
      encryptionKey,
      oldAccessHash: row.hash,
    });
  } catch (err) {
    console.error("[auth/refresh] failed to persist new tokens:", err);
    return jsonError("Failed to persist refreshed session", 500);
  }

  return new Response(
    JSON.stringify({ token: result.accessToken }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
