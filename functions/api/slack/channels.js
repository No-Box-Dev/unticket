import { getCtx, jsonResponse, errorResponse } from "../../lib/db";
import { resolveSlackInstall, listSlackChannels } from "../../lib/slack";

// GET /api/slack/channels
//
// Lists the channels the bot has access to in this org's workspace. Used
// to populate the Posts feed / Release notes feed channel dropdowns in
// Settings. Admin-only because the only consumer is the admin settings UI.
export async function onRequestGet(context) {
  const { orgId, isAdmin } = getCtx(context);
  if (!orgId) return errorResponse("Missing org context", 400);
  if (!isAdmin) return errorResponse("Admin required", 403);

  const install = await resolveSlackInstall(context.env, orgId);
  if (!install) return errorResponse("Slack not connected", 404);

  try {
    const channels = await listSlackChannels(install.botToken);
    return jsonResponse({ channels });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err), 502);
  }
}
