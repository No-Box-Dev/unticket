import { getCtx, jsonResponse, errorResponse } from "../../lib/db";
import { isValidSlackWebhookUrl, postToSlack } from "../../lib/slack";

// POST /api/slack/test — admin-only.
// Body: { url: string, kind?: "narrative" | "release_notes" }
// Sends a sample message to the given webhook URL so admins can verify
// connectivity + channel before saving settings. Never touches D1.
export async function onRequestPost(context) {
  const { isAdmin, orgLogin } = getCtx(context);
  if (!isAdmin) return errorResponse("Admin required", 403);
  if (!orgLogin) return errorResponse("Missing org context", 400);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!isValidSlackWebhookUrl(url)) {
    return errorResponse("URL must be an https://hooks.slack.com/... incoming webhook", 400);
  }
  const kind = body?.kind === "release_notes" ? "release_notes" : "narrative";

  const payload =
    kind === "release_notes"
      ? {
          text: `Unticket release-notes webhook test for ${orgLogin}`,
          blocks: [
            { type: "section", text: { type: "mrkdwn", text: `*Unticket — release notes webhook test*\n_Org: \`${orgLogin}\`_` } },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text:
                  "```\n📦 unticket #0 Merged - Test\nRepository: unticket\nDetails: This is a connectivity test from Unticket.\nIf you see this in the channel, the webhook is wired up correctly.\n```",
              },
            },
          ],
        }
      : {
          text: `Unticket posts webhook test for ${orgLogin}`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Unticket — posts webhook test*\nIf you see this in the channel, the webhook is wired up correctly. (Org \`${orgLogin}\`)`,
              },
            },
          ],
        };

  try {
    await postToSlack(url, payload);
    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err), 502);
  }
}
