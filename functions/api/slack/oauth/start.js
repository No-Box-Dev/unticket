import { getCtx, errorResponse } from "../../../lib/db";
import { buildOAuthAuthorizeUrl, signOAuthState } from "../../../lib/slack";

// POST /api/slack/oauth/start
//
// Admin-only. Returns a Slack authorize URL with an HMAC-signed `state`
// param + a matching CSRF cookie. The client opens that URL and Slack
// redirects back to /api/slack/oauth/callback with code + state. State
// carries orgId, but the callback verifies the HMAC (signed with the
// Slack client secret, server-side only) BEFORE trusting orgId — so a
// forged state can't trick the callback into installing into another
// org even if the cookie comparison were somehow bypassed.
export async function onRequestPost(context) {
  const { isAdmin, orgId, orgLogin, userLogin } = getCtx(context);
  if (!isAdmin) return errorResponse("Admin required", 403);
  if (!orgId || !orgLogin) return errorResponse("Missing org context", 400);

  const clientId = context.env.SLACK_CLIENT_ID;
  const clientSecret = context.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return errorResponse("Slack app not configured on this deployment", 503);
  }

  const origin = new URL(context.request.url).origin;
  const nonceArr = new Uint8Array(32);
  crypto.getRandomValues(nonceArr);
  const nonce = [...nonceArr].map((b) => b.toString(16).padStart(2, "0")).join("");
  const payload = `${nonce}:${orgId}:${encodeURIComponent(userLogin || "")}`;
  const sig = await signOAuthState(clientSecret, payload);
  const state = `${payload}.${sig}`;

  return new Response(JSON.stringify({ url: buildOAuthAuthorizeUrl(clientId, origin, state) }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // 10-min CSRF cookie; Lax so it survives the Slack → callback redirect.
      "Set-Cookie": `ut_slack_state=${state}; Path=/; Max-Age=600; SameSite=Lax; Secure; HttpOnly`,
    },
  });
}
