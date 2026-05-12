import { getCtx, jsonResponse } from "../lib/db";

// GET /api/me — returns the authenticated user's identity for the current org
// plus the app-level admin flag bootstrapped in `functions/_middleware.js`.
// Clients use this in place of GitHub's /orgs/{org}/memberships/{user}, which
// is a heavy authz check on every load and doesn't carry app-level state.
export async function onRequestGet(context) {
  const { userLogin, orgLogin, isAdmin } = getCtx(context);
  return jsonResponse({
    login: userLogin,
    org: orgLogin,
    isAdmin: Boolean(isAdmin),
  });
}
