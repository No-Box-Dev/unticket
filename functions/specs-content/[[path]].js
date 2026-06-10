// Spec content proxy — serves files from the configured spec repo under
//   /specs-content/<orgLogin>/<specName>/<relative-path>
// so HTML specs render with their relative-linked assets resolving correctly.
//
// Auth: the `ut_session` cookie (set by the dashboard from localStorage's
// GitHub access token after login). Not via /api/_middleware because
// browser sub-resource loads never carry Authorization headers — only
// cookies. The proxy validates token + org-membership the same way the
// middleware does for /api/* routes.
//
// CSP note: the served HTML runs same-origin against app.unticket.ai.
// Admins trust whoever can write to the spec repo — this is documented
// in the Settings UI. nosniff + Referrer-Policy applied defensively.

import { resolveSpecsConfig, fetchSpecFile, isSafeSegment, hasUnsafePathSegment } from "../lib/specs";

const SESSION_COOKIE = "ut_session";

// Per-worker in-memory caches mirror /api/_middleware's pattern. Without
// these, every browser sub-resource load (every <img>, <script>, <link>
// inside an HTML spec) would hit GitHub's /user + /orgs/<o>/members/<u>
// endpoints, burning the user's rate limit on what should be one auth
// check per page. Keys are SHA-256 token hashes so raw tokens never sit
// in Map keys (matches the middleware's `hashToken` discipline).
const TOKEN_TTL_MS = 5 * 60_000;   // 5 min — same as middleware
const MEMBER_TTL_MS = 5 * 60_000;
const tokenCache = new Map();      // tokenHash -> { login, expiresAt }
const membershipCache = new Map(); // `${tokenHash}:${orgLogin}` -> { isMember, expiresAt }

async function hashToken(token) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Mirrors /api/_middleware's distinction. Returns:
//   { login, key }       — valid token
//   { rateLimited: true } — GitHub throttled us; treat as transient, don't logout
//   null                  — actually invalid / revoked
async function validateToken(token) {
  const key = await hashToken(token);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { login: cached.login, key };
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "Unticket" },
  });
  if (res.status === 429 || res.status === 403) return { rateLimited: true };
  if (!res.ok) return null;
  const user = await res.json();
  if (!user?.login) return null;
  tokenCache.set(key, { login: user.login, expiresAt: Date.now() + TOKEN_TTL_MS });
  return { login: user.login, key };
}

// Only positive membership is cached — same discipline as middleware. A
// transient GitHub 5xx or a one-time "not a member" must not pin a user
// to 403 for the full TTL while the rest of the app accepts them again.
async function isOrgMember(token, tokenHash, orgLogin, userLogin) {
  const cacheKey = `${tokenHash}:${orgLogin}`;
  const cached = membershipCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return true;
  const res = await fetch(
    `https://api.github.com/orgs/${encodeURIComponent(orgLogin)}/members/${encodeURIComponent(userLogin)}`,
    { headers: { Authorization: `Bearer ${token}`, "User-Agent": "Unticket" } },
  );
  if (res.status === 204) {
    membershipCache.set(cacheKey, { expiresAt: Date.now() + MEMBER_TTL_MS });
    return true;
  }
  return false;
}

export async function onRequestGet(context) {
  const parts = context.params.path;
  const segments = Array.isArray(parts) ? parts : (typeof parts === "string" ? [parts] : []);
  if (segments.length < 3) return new Response("Not Found", { status: 404 });

  const [orgLogin, specName, ...rest] = segments;
  const relativePath = rest.join("/");
  if (!isSafeOrgLogin(orgLogin) || !isSafeSegment(specName) || hasUnsafePathSegment(relativePath)) {
    return new Response("Bad Request", { status: 400 });
  }

  const cookies = parseCookies(context.request.headers.get("Cookie") || "");
  const token = cookies[SESSION_COOKIE];
  if (!token) return new Response("Not signed in", { status: 401 });

  // 1. Validate token → who is this user? Cached for 5 min to keep asset
  //    loads in an HTML spec off GitHub's /user endpoint.
  const validated = await validateToken(token);
  if (!validated) return new Response("Invalid session", { status: 401 });
  if (validated.rateLimited) {
    // Don't 401 (which would force-logout via the client's 401 handler) —
    // signal that this is transient so the browser will retry shortly.
    return new Response("GitHub rate limit reached, try again shortly", {
      status: 503,
      headers: { "Retry-After": "30" },
    });
  }

  // 2. Verify org membership. Same per-token cache discipline.
  if (!(await isOrgMember(token, validated.key, orgLogin, validated.login))) {
    return new Response("Not a member of this org", { status: 403 });
  }

  // 3. Resolve the org + apply the same operator-kill-switch as middleware.
  //    Mirror middleware's auto-create so a logged-in member opening a spec
  //    URL before they've ever hit /api/* (rare but possible) still works.
  //    Suspended orgs are blocked here too.
  let orgRow = await context.env.DB
    .prepare("SELECT id, suspended_at FROM orgs WHERE github_login = ?")
    .bind(orgLogin)
    .first();
  if (!orgRow) {
    try {
      orgRow = await context.env.DB
        .prepare("INSERT INTO orgs (github_login) VALUES (?) RETURNING id, suspended_at")
        .bind(orgLogin)
        .first();
    } catch {
      // Race with middleware: re-select after a concurrent insert wins.
      orgRow = await context.env.DB
        .prepare("SELECT id, suspended_at FROM orgs WHERE github_login = ?")
        .bind(orgLogin)
        .first();
    }
  }
  if (!orgRow?.id) return new Response("Failed to resolve organization", { status: 500 });
  if (orgRow.suspended_at) return new Response("Organization suspended", { status: 403 });

  const cfg = await resolveSpecsConfig(context.env.DB, orgRow.id);
  if (!cfg.configured) return new Response("Specs not configured", { status: 404 });

  // 4. Fetch + serve.
  try {
    const file = await fetchSpecFile(context.env, cfg.repo, cfg.rootPath, specName, relativePath);
    if (!file) return new Response("Not Found", { status: 404 });
    return new Response(file.bytes, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.bytes.byteLength),
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), { status: 502 });
  }
}

function isSafeOrgLogin(s) {
  return typeof s === "string" && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(s);
}

function parseCookies(cookieHeader) {
  const cookies = {};
  for (const pair of cookieHeader.split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (!key) continue;
    const raw = rest.join("=").trim();
    // Tolerate malformed percent-encoding rather than throwing a 500 from
    // the worker — an invalid cookie should just fail the 401 path below.
    let value;
    try { value = decodeURIComponent(raw); }
    catch { value = raw; }
    cookies[key.trim()] = value;
  }
  return cookies;
}
