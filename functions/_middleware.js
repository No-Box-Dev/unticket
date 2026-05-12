import { encryptToken } from "./lib/crypto";

// Cache validated tokens for 5 min to avoid hammering GitHub /user
const tokenCache = new Map();
// Cache org membership checks (keyed by tokenHash:orgLogin)
const membershipCache = new Map();

// Fraction of authenticated requests that also sweep expired sessions.
// At ~5 req/s steady state this fires every ~20s — frequent enough to keep the
// sessions table small without paying for it on every request.
const SESSION_CLEANUP_RATE = 0.01;

/** Hash a token with SHA-256 so raw tokens are never used as Map keys. */
async function hashToken(token) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validates a GitHub token. Returns:
 *   { login: string }             — valid token
 *   { error: "rate_limited", ... } — GitHub rate-limited the validation call
 *   { error: "invalid" }          — bad / revoked token
 */
async function validateGitHubToken(token) {
  const cacheKey = await hashToken(token);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { login: cached.login, _cacheKey: cacheKey };
  }

  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "Unticket",
    },
  });

  if (!res.ok) {
    // 403 from GitHub /user is almost always rate limiting, never an invalid
    // token (invalid tokens get 401). Treat all 403s as rate-limited to avoid
    // accidentally force-logging the user out.
    const retryAfter = res.headers.get("Retry-After");
    const isRateLimited = res.status === 429 || res.status === 403;
    if (isRateLimited) {
      const resetEpoch = res.headers.get("X-RateLimit-Reset");
      return { error: "rate_limited", resetEpoch, retryAfter };
    }
    // Token revoked / invalid — drop any stale cache entry so a re-auth
    // with a fresh token isn't blocked by a poisoned cache.
    tokenCache.delete(cacheKey);
    return { error: "invalid" };
  }

  const user = await res.json();
  tokenCache.set(cacheKey, {
    login: user.login,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  return { login: user.login, _cacheKey: cacheKey };
}

/**
 * Verify user is a member of the given org. Caches for 5 min.
 * Returns true if member, false otherwise.
 */
async function verifyOrgMembership(token, tokenHash, orgLogin, userLogin) {
  const cacheKey = `${tokenHash}:${orgLogin}`;
  const cached = membershipCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.isMember;
  }

  const res = await fetch(
    `https://api.github.com/orgs/${encodeURIComponent(orgLogin)}/members/${encodeURIComponent(userLogin)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Unticket",
      },
    },
  );

  // 204 = member, 302 = requester is not an org member, 404 = not a member
  const isMember = res.status === 204;
  // Only cache positive results. A negative cache would lock the user out for
  // the full TTL after they're freshly added to the org.
  if (isMember) {
    membershipCache.set(cacheKey, {
      isMember: true,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
  }
  return isMember;
}

export async function onRequest(context) {
  const url = new URL(context.request.url);

  // Skip auth for OAuth callback and webhook
  if (url.pathname.startsWith("/api/auth/") || url.pathname === "/api/webhook") {
    return context.next();
  }

  // Skip middleware for non-API routes
  if (!url.pathname.startsWith("/api/")) {
    return context.next();
  }

  const authHeader = context.request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const token = authHeader.slice(7);
  const validation = await validateGitHubToken(token);

  if (validation.error === "rate_limited") {
    const resetInfo = validation.resetEpoch
      ? ` Resets at ${new Date(Number(validation.resetEpoch) * 1000).toISOString()}`
      : "";
    return new Response(
      JSON.stringify({ error: `GitHub API rate limit exceeded.${resetInfo}` }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          ...(validation.resetEpoch ? { "Retry-After": String(Math.max(0, Number(validation.resetEpoch) - Math.floor(Date.now() / 1000))) } : {}),
        },
      },
    );
  }

  if (validation.error === "invalid") {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userLogin = validation.login;
  const tokenHash = validation._cacheKey;

  // Resolve org from header or query param
  const orgLogin =
    context.request.headers.get("X-Org") || url.searchParams.get("org");
  if (!orgLogin) {
    return new Response(JSON.stringify({ error: "Missing X-Org header or org query param" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify user is a member of the requested org before proceeding
  const isMember = await verifyOrgMembership(token, tokenHash, orgLogin, userLogin);
  if (!isMember) {
    return new Response(JSON.stringify({ error: "Not a member of this organization" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Ensure org exists in D1 (auto-create only after membership is verified)
  let orgRow = await context.env.DB.prepare(
    "SELECT id FROM orgs WHERE github_login = ?"
  ).bind(orgLogin).first();

  if (!orgRow) {
    try {
      const result = await context.env.DB.prepare(
        "INSERT INTO orgs (github_login) VALUES (?) RETURNING id"
      ).bind(orgLogin).first();
      orgRow = result;
    } catch (e) {
      // Race condition: another request may have inserted the org concurrently
      orgRow = await context.env.DB.prepare(
        "SELECT id FROM orgs WHERE github_login = ?"
      ).bind(orgLogin).first();
      if (!orgRow) {
        return new Response(JSON.stringify({ error: "Failed to resolve organization" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
  }

  // Upsert session (encrypt token before storing in D1)
  const encryptionKey = context.env.ENCRYPTION_KEY;
  const encryptedToken = await encryptToken(token, encryptionKey);
  await context.env.DB.prepare(
    `INSERT INTO sessions (org_id, github_login, encrypted_token, updated_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
     ON CONFLICT(org_id, github_login) DO UPDATE SET
       encrypted_token = excluded.encrypted_token,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`
  ).bind(orgRow.id, userLogin, encryptedToken).run();

  // Admin bootstrap: the first authenticated user from each org auto-promotes
  // to admin. The INSERT is a single atomic statement (SELECT … WHERE NOT
  // EXISTS) so concurrent requests can't both win — SQLite serializes the
  // writes and the loser sees the row from the winner.
  const [, adminCheck] = await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO org_admins (org_id, login, granted_at)
       SELECT ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE NOT EXISTS (SELECT 1 FROM org_admins WHERE org_id = ?)`,
    ).bind(orgRow.id, userLogin, orgRow.id),
    context.env.DB.prepare(
      "SELECT 1 AS is_admin FROM org_admins WHERE org_id = ? AND login = ?",
    ).bind(orgRow.id, userLogin),
  ]);
  const isAdmin = (adminCheck.results?.length ?? 0) > 0;

  // Probabilistic session cleanup: SESSION_CLEANUP_RATE of requests trigger a sweep
  // of sessions older than 30 days. Keeping this here (vs a cron) means cleanup is
  // free-rolling and self-throttling at request volume.
  if (Math.random() < SESSION_CLEANUP_RATE) {
    context.waitUntil(
      context.env.DB.prepare(
        "DELETE FROM sessions WHERE updated_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-30 days')"
      ).run().catch((err) => console.error("[unticket] Session cleanup failed:", err))
    );
  }

  // Set context data for downstream handlers (plaintext token for API calls)
  context.data.orgId = orgRow.id;
  context.data.orgLogin = orgLogin;
  context.data.userLogin = userLogin;
  context.data.token = token;
  context.data.isAdmin = isAdmin;

  return context.next();
}
