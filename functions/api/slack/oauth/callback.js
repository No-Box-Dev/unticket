import { exchangeOAuthCode, saveSlackInstall } from "../../../lib/slack";

// GET /api/slack/oauth/callback?code=...&state=...
//
// Bypassed by the auth middleware (browser redirect from Slack carries no
// Authorization header). Verifies state against the ut_slack_state cookie
// (set by /start), exchanges the code, persists the bot token. On success
// or failure we redirect back to /?slack=ok|error so the SPA can refresh
// the Slack section.
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  // User cancelled in Slack's confirm screen — just send them home.
  if (errorParam) {
    return redirectHome(url, "cancelled");
  }

  if (!code || !state) return redirectHome(url, "missing-code-or-state");

  const cookies = parseCookies(context.request.headers.get("Cookie") || "");
  const cookieState = cookies["ut_slack_state"] || "";
  if (!cookieState || cookieState !== state) {
    return redirectHome(url, "csrf");
  }

  const parts = state.split(":");
  const orgId = Number(parts[1]);
  const userLogin = parts[2] ? decodeURIComponent(parts[2]) : "";
  if (!Number.isFinite(orgId) || orgId <= 0) return redirectHome(url, "bad-state");

  const clientId = context.env.SLACK_CLIENT_ID;
  const clientSecret = context.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) return redirectHome(url, "app-not-configured");

  let install;
  try {
    install = await exchangeOAuthCode({
      clientId,
      clientSecret,
      code,
      redirectUri: `${url.origin}/api/slack/oauth/callback`,
    });
  } catch (err) {
    console.error("[unticket slack oauth] exchange failed:", err?.message ?? err);
    return redirectHome(url, "exchange-failed");
  }

  try {
    await saveSlackInstall(context.env, orgId, { ...install, installedBy: userLogin });
  } catch (err) {
    console.error("[unticket slack oauth] persist failed:", err?.message ?? err);
    return redirectHome(url, "persist-failed");
  }

  return redirectHome(url, "ok");
}

function redirectHome(url, status) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${url.origin}/?tab=settings&slack=${encodeURIComponent(status)}`,
      "Cache-Control": "no-store",
      // Always clear the CSRF cookie even on failure paths.
      "Set-Cookie": "ut_slack_state=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly",
    },
  });
}

function parseCookies(cookieHeader) {
  const cookies = {};
  for (const pair of cookieHeader.split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (!key) continue;
    cookies[key.trim()] = rest.join("=").trim();
  }
  return cookies;
}
