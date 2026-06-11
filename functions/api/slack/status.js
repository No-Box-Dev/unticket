import { getCtx, jsonResponse, errorResponse } from "../../lib/db";
import { resolveSlackInstall, resolveSlackChannels } from "../../lib/slack";

// GET /api/slack/status
//
// Returns whether this org has a Slack app connected, the workspace name
// (so Settings can show "Connected to <team>"), and the configured per-feed
// channel selections. Never returns the bot token.
export async function onRequestGet(context) {
  const { orgId, isAdmin } = getCtx(context);
  if (!orgId) return errorResponse("Missing org context", 400);

  const install = await resolveSlackInstall(context.env, orgId);
  const channels = await resolveSlackChannels(context.env.DB, orgId);

  return jsonResponse({
    connected: !!install,
    teamId: install?.teamId ?? null,
    teamName: install?.teamName ?? null,
    botUserId: install?.botUserId ?? null,
    postsChannelId: channels.postsChannelId,
    releaseNotesChannelId: channels.releaseNotesChannelId,
    canConfigure: isAdmin,
    appConfigured: !!context.env.SLACK_CLIENT_ID,
  });
}
