import { getCtx, jsonResponse, errorResponse } from "../../lib/db";
import { resolveSlackInstall, postSlackMessage } from "../../lib/slack";

// POST /api/slack/test
// Body: { channelId: string, kind?: "narrative" | "release_notes" }
//
// Admin-only. Posts a sample message to the given channel so the admin can
// verify the bot is installed in the right workspace + the channel routes
// correctly before saving the channel selection.
export async function onRequestPost(context) {
  const { orgId, orgLogin, isAdmin } = getCtx(context);
  if (!orgId || !orgLogin) return errorResponse("Missing org context", 400);
  if (!isAdmin) return errorResponse("Admin required", 403);

  let body;
  try { body = await context.request.json(); }
  catch { return errorResponse("Invalid JSON body", 400); }

  const channelId = typeof body?.channelId === "string" ? body.channelId.trim() : "";
  if (!channelId) return errorResponse("channelId required", 400);
  const kind = body?.kind === "release_notes" ? "release_notes" : "narrative";

  const install = await resolveSlackInstall(context.env, orgId);
  if (!install) return errorResponse("Slack not connected", 404);

  const payload = kind === "release_notes"
    ? {
        text: `Unticket release-notes channel test for ${orgLogin}`,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `*Unticket — release notes channel test*\n_Org: \`${orgLogin}\`_` } },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                "```\n📦 unticket #0 Merged - Test\nRepository: unticket\nDetails: Connectivity test from Unticket.\nIf you see this, the bot can post here.\n```",
            },
          },
        ],
      }
    : {
        text: `Unticket posts channel test for ${orgLogin}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Unticket — posts channel test*\nIf you see this, the bot can post here. (Org \`${orgLogin}\`)`,
            },
          },
        ],
      };

  try {
    await postSlackMessage(install.botToken, channelId, payload);
    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err), 502);
  }
}
