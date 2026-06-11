import { getCtx, jsonResponse, errorResponse } from "../../../lib/db";
import { buildOAuthAuthorizeUrl } from "../../../lib/slack";

// POST /api/slack/oauth/start
//
// Admin-only. Returns a Slack authorize URL with a CSRF-protected `state`
// param. The client opens that URL (full-page navigation) and Slack redirects
// back to /api/slack/oauth/callback with the code + state. State carries the
// orgId so the callback (which is unauth) knows which org to install into.
// Response also sets a cookie so the callback can verify the state matches.
export async function onRequestPost(context) {
  const { isAdmin, orgId, orgLogin, userLogin } = getCtx(context);
  if (!isAdmin) return errorResponse("Admin required", 403);
  if (!orgId || !orgLogin) return errorResponse("Missing org context", 400);

  const clientId = context.env.SLACK_CLIENT_ID;
  if (!clientId) return errorResponse("Slack app not configured on this deployment", 503);

  const origin = new URL(context.request.url).origin;
  // State = nonce + ":" + orgId + ":" + userLogin. The callback's only job
  // wrt CSRF is to confirm the state matches the cookie; the embedded info
  // is convenience, not trust (the cookie comparison is the gate).
  const nonceArr = new Uint8Array(32);
  crypto.getRandomValues(nonceArr);
  const nonce = [...nonceArr].map((b) => b.toString(16).padStart(2, "0")).join("");
  const state = `${nonce}:${orgId}:${encodeURIComponent(userLogin || "")}`;

  return new Response(JSON.stringify({ url: buildOAuthAuthorizeUrl(clientId, origin, state) }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // 10-min CSRF cookie; Lax so it survives the Slack → callback redirect.
      "Set-Cookie": `ut_slack_state=${state}; Path=/; Max-Age=600; SameSite=Lax; Secure; HttpOnly`,
    },
  });
}
