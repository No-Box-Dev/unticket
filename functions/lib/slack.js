// Slack posting for the Posts and Release-notes feeds.
//
// Uses incoming-webhook URLs (one per channel) instead of OAuth — admins
// create a dedicated Slack app, add an Incoming Webhook per channel, and
// paste the URL into Settings → Slack. Two URLs total: one for narrative
// posts, one for release notes. Either can be empty to disable that feed.
//
// Webhooks are stored plaintext under `settings.slack.*WebhookUrl`. They
// authorize posting to one channel only (no read access), so they're a
// lower-stakes secret than the LLM API key. Admins editing settings can
// already see/edit all org config; treating these as plaintext config is
// consistent with that trust model.

const TIMEOUT_MS = 5000;
const SLACK_HOSTNAME = "hooks.slack.com";

// Defense in depth: a misconfigured/malicious settings row could try to
// point us at an internal URL. Hard-fail anything not on hooks.slack.com.
export function isValidSlackWebhookUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" && u.hostname === SLACK_HOSTNAME;
  } catch {
    return false;
  }
}

// POST to a Slack incoming webhook. Throws on non-2xx so callers can record
// the failure to op_failures. Times out at 5s so a stalled Slack endpoint
// never holds the queue worker open.
export async function postToSlack(url, payload) {
  if (!isValidSlackWebhookUrl(url)) {
    throw new Error("Invalid Slack webhook URL (must be https://hooks.slack.com/...)");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`Slack ${res.status} ${res.statusText}: ${detail}`);
  }
  return res;
}

// Read the per-org Slack settings from D1 config. Returns an object with
// both URLs (possibly empty strings) so callers can branch on "configured?"
// without re-parsing JSON.
export async function resolveSlackSettings(db, orgId) {
  if (!db || !orgId) return { postsWebhookUrl: "", releaseNotesWebhookUrl: "" };
  try {
    const row = await db
      .prepare("SELECT data FROM config WHERE org_id = ? AND key = 'settings'")
      .bind(orgId)
      .first();
    if (!row?.data) return { postsWebhookUrl: "", releaseNotesWebhookUrl: "" };
    const settings = JSON.parse(row.data);
    const slack = settings?.slack;
    if (!slack || typeof slack !== "object") {
      return { postsWebhookUrl: "", releaseNotesWebhookUrl: "" };
    }
    return {
      postsWebhookUrl: typeof slack.postsWebhookUrl === "string" ? slack.postsWebhookUrl.trim() : "",
      releaseNotesWebhookUrl:
        typeof slack.releaseNotesWebhookUrl === "string" ? slack.releaseNotesWebhookUrl.trim() : "",
    };
  } catch {
    return { postsWebhookUrl: "", releaseNotesWebhookUrl: "" };
  }
}

// Block Kit payload for a Posts feed entry — chat-style with author and a
// link button to the PR. Uses mrkdwn so usernames/repo names stay readable
// in dense feeds.
export function buildPostsBlocks({ actorName, projectName, summary, prUrl, prNumber, avatarUrl }) {
  const header = [actorName ? `*${escapeMrkdwn(actorName)}*` : "*Unknown*"];
  if (projectName) header.push(`\`${escapeMrkdwn(projectName)}\``);
  const blocks = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `${header.join("  •  ")}\n${escapeMrkdwn(summary || "(no summary)")}` },
      ...(avatarUrl ? { accessory: { type: "image", image_url: avatarUrl, alt_text: actorName || "actor" } } : {}),
    },
  ];
  if (prUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: prNumber ? `View PR #${prNumber}` : "View PR" },
          url: prUrl,
        },
      ],
    });
  }
  return { text: stripForFallback(summary), blocks };
}

// Block Kit payload for a Release-notes feed entry — preserves the
// multi-section structured text inside a code-style block so newlines and
// inline labels (Repository:, Type:, …) stay aligned.
export function buildReleaseNotesBlocks({ projectName, summary, prUrl, prNumber }) {
  const header = projectName
    ? `*Release note* — \`${escapeMrkdwn(projectName)}\``
    : "*Release note*";
  const blocks = [
    { type: "section", text: { type: "mrkdwn", text: header } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        // Wrap in a code fence so Slack preserves whitespace + section labels.
        // Cap at ~2800 chars to stay comfortably under Slack's 3000-char text limit.
        // Sanitize any embedded ``` runs so a model (or custom prompt) emitting
        // backtick fences can't close ours early and spill the rest of the note
        // outside the code block.
        text: "```\n" + truncate(sanitizeForCodeFence(summary ?? "(no release note)"), 2800) + "\n```",
      },
    },
  ];
  if (prUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: prNumber ? `View PR #${prNumber}` : "View PR" },
          url: prUrl,
        },
      ],
    });
  }
  return { text: stripForFallback(summary), blocks };
}

// Slack mrkdwn escaping — only the three chars that have meaning. The
// emoji/code-fence/quote tokens are positional and don't need escaping
// inside section text.
function escapeMrkdwn(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

function stripForFallback(s) {
  return truncate(String(s ?? "").replace(/\s+/g, " ").trim(), 140);
}

function truncate(s, max) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// Break up any run of 3+ backticks so it can't close a wrapping code fence.
// Inserts a zero-width space between each backtick — visually identical in
// Slack, but the fence-matcher no longer sees consecutive backticks.
function sanitizeForCodeFence(s) {
  return String(s ?? "").replace(/`{3,}/g, (m) => m.split("").join("​"));
}
