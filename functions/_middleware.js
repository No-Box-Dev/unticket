// Cache validated tokens for 5 min to avoid hammering GitHub /user
const tokenCache = new Map();

async function validateGitHubToken(token) {
  const cacheKey = token.slice(-8); // use last 8 chars as key
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.login;
  }

  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "GitPulse",
    },
  });

  if (!res.ok) return null;

  const user = await res.json();
  tokenCache.set(cacheKey, {
    login: user.login,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  return user.login;
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
  const userLogin = await validateGitHubToken(token);
  if (!userLogin) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

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
