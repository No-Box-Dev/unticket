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

  // 1. Validate token → who is this user?
  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "Unticket" },
  });
  if (!userRes.ok) return new Response("Invalid session", { status: 401 });
  const user = await userRes.json();
  if (!user?.login) return new Response("Invalid session", { status: 401 });

  // 2. Verify membership in the requested org. Mirrors middleware behavior.
  const memberRes = await fetch(
    `https://api.github.com/orgs/${encodeURIComponent(orgLogin)}/members/${encodeURIComponent(user.login)}`,
    { headers: { Authorization: `Bearer ${token}`, "User-Agent": "Unticket" } },
  );
  if (memberRes.status !== 204) return new Response("Not a member of this org", { status: 403 });

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
