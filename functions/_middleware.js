// Cache validated tokens for 5 min to avoid hammering GitHub /user
const tokenCache = new Map();

/**
 * Validates a GitHub token. Returns:
 *   { login: string }             — valid token
 *   { error: "rate_limited", ... } — GitHub rate-limited the validation call
 *   { error: "invalid" }          — bad / revoked token
 */
async function validateGitHubToken(token) {
  const cacheKey = token;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { login: cached.login };
  }

  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "GitPulse",
    },
  });

  if (!res.ok) {
    // Distinguish rate limiting from a genuinely invalid token.
    // Secondary rate limits return 403 with Retry-After but non-zero remaining.
    const remaining = res.headers.get("X-RateLimit-Remaining");
    const retryAfter = res.headers.get("Retry-After");
    const isRateLimited =
      res.status === 429 ||
      (res.status === 403 && (remaining === "0" || retryAfter !== null));
    if (isRateLimited) {
      const resetEpoch = res.headers.get("X-RateLimit-Reset");
      return { error: "rate_limited", resetEpoch, retryAfter };
    }
    return { error: "invalid" };
  }

  const user = await res.json();
  tokenCache.set(cacheKey, {
    login: user.login,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  return { login: user.login };
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

  // Resolve org from header or query param
  const orgLogin =
    context.request.headers.get("X-Org") || url.searchParams.get("org");
  if (!orgLogin) {
    return new Response(JSON.stringify({ error: "Missing X-Org header or org query param" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Ensure org exists in D1 (auto-create if not)
  let orgRow = await context.env.DB.prepare(
    "SELECT id FROM orgs WHERE github_login = ?"
  ).bind(orgLogin).first();

  if (!orgRow) {
    const result = await context.env.DB.prepare(
      "INSERT INTO orgs (github_login) VALUES (?) RETURNING id"
    ).bind(orgLogin).first();
    orgRow = result;
  }

  // Upsert session
  await context.env.DB.prepare(
    `INSERT INTO sessions (org_id, github_login, encrypted_token, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(org_id, github_login) DO UPDATE SET
       encrypted_token = excluded.encrypted_token,
       updated_at = datetime('now')`
  ).bind(orgRow.id, userLogin, token).run();

  // Set context data for downstream handlers
  context.data.orgId = orgRow.id;
  context.data.orgLogin = orgLogin;
  context.data.userLogin = userLogin;
  context.data.token = token;

  return context.next();
}
