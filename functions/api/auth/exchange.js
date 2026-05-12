import { decryptToken } from "../../lib/crypto";

/**
 * POST /api/auth/exchange
 * Exchanges a one-time auth code for the GitHub access token.
 * The code is deleted after use (one-time only).
 */
export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonError("Invalid request body", 400);
  }

  const { code } = body;
  if (!code || typeof code !== "string") {
    return jsonError("Missing exchange code", 400);
  }

  // Clean up expired pending tokens first
  await context.env.DB.prepare(
    "DELETE FROM pending_tokens WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-5 minutes')"
  ).run();

  // Look up and delete the pending token in one step
  const row = await context.env.DB.prepare(
    "DELETE FROM pending_tokens WHERE code = ? RETURNING encrypted_token"
  ).bind(code).first();

  if (!row) {
    return jsonError("Invalid or expired exchange code", 401);
  }

  // Decrypt the token. Any malformed value (extremely unlikely — migration
  // 0016 deleted legacy plaintext rows and the new code writes only iv:cipher)
  // forces the user back through OAuth rather than 500ing.
  const encryptionKey = context.env.ENCRYPTION_KEY;
  let token;
  try {
    token = await decryptToken(row.encrypted_token, encryptionKey);
  } catch (err) {
    console.error("[auth/exchange] decryptToken failed:", err?.message ?? err);
    return jsonError("Invalid or expired exchange code", 401);
  }

  return new Response(JSON.stringify({ token }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
