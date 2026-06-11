import { getCtx, jsonResponse, errorResponse } from "../../lib/db";
import { deleteSlackInstall } from "../../lib/slack";

// POST /api/slack/disconnect — admin-only. Deletes this org's slack_settings
// row (effectively uninstalling the bot from unticket's side). The Slack
// workspace admin can also remove the app from Slack independently; this
// just stops unticket from posting.
export async function onRequestPost(context) {
  const { orgId, isAdmin } = getCtx(context);
  if (!orgId) return errorResponse("Missing org context", 400);
  if (!isAdmin) return errorResponse("Admin required", 403);

  await deleteSlackInstall(context.env, orgId);
  return jsonResponse({ ok: true });
}
