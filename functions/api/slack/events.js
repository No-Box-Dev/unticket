// Slack Events API endpoint — handles the `link_shared` event so unticket
// URLs pasted into Slack messages auto-expand into rich Block Kit cards.
//
// Endpoint contract with Slack:
//   1. `url_verification` — one-time handshake when the URL is configured
//      in the Slack app admin. Echo the `challenge` string.
//   2. `event_callback` — regular event delivery. We only handle
//      `event.type === "link_shared"`; everything else 200s silently so
//      Slack doesn't retry.
//
// Auth model: Slack signs every request with SLACK_SIGNING_SECRET (see
// verifySlackSignature). Middleware bypasses the bearer check for this
// path; the signature IS the auth.
//
// URL shapes we unfurl:
//   /prs/{repo}/{number}       → PR title, author, draft/merged state
//   /issues/{repo}/{number}    → Issue title, assignee, labels
//   /?tab=sprint&f={number}    → Feature title, owners, status
// Anything else falls through and Slack renders the raw URL.

import { recordFailure } from "../../lib/op-failures.js";
import {
  resolveInstallByTeamId,
  unfurlSlackLinks,
  verifySlackSignature,
} from "../../lib/slack.js";

const APP_HOST = "app.unticket.ai";

export async function onRequestPost(context) {
  const { request, env } = context;

  const rawBody = await request.text();
  const timestamp = request.headers.get("X-Slack-Request-Timestamp") ?? "";
  const signature = request.headers.get("X-Slack-Signature") ?? "";

  // The signing secret gates every request — without it, silently return
  // 200 so Slack's setup UI can still see the endpoint respond, but never
  // actually process an event. In practice this branch means the deploy
  // is misconfigured, not that Slack is malicious.
  if (!env.SLACK_SIGNING_SECRET) {
    return new Response("ok", { status: 200 });
  }

  const valid = await verifySlackSignature({
    signingSecret: env.SLACK_SIGNING_SECRET,
    timestamp,
    signature,
    rawBody,
  });
  if (!valid) {
    return new Response(JSON.stringify({ error: "bad signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "bad json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Slack's one-time URL verification handshake — echo `challenge` back
  // as plain text (not JSON) per their spec so the app-admin setup UI
  // marks the URL as verified.
  if (payload.type === "url_verification") {
    return new Response(payload.challenge ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (payload.type !== "event_callback") return new Response("ok", { status: 200 });
  const event = payload.event ?? {};
  if (event.type !== "link_shared") return new Response("ok", { status: 200 });

  // Respond 200 immediately — Slack wants a fast ack. The unfurl work
  // happens on waitUntil so retries don't fire. Failures land in
  // op_failures once the org is known; anything earlier (bad workspace,
  // no install) is a silent no-op — not our problem to log.
  context.waitUntil(handleLinkShared(env, payload));

  return new Response("ok", { status: 200 });
}

// ---- handler ----

async function handleLinkShared(env, payload) {
  const event = payload.event;
  const teamId = payload.team_id ?? payload.authorizations?.[0]?.team_id;
  const install = await resolveInstallByTeamId(env, teamId);
  if (!install) return; // workspace isn't connected — nothing to do

  try {
    const unfurls = {};
    for (const link of event.links ?? []) {
      if (link.domain !== APP_HOST) continue;
      const parsed = parseUnticketUrl(link.url);
      if (!parsed) continue;
      const block = await buildUnfurl(env, install.orgId, parsed);
      if (block) unfurls[link.url] = block;
    }

    if (Object.keys(unfurls).length === 0) return;

    await unfurlSlackLinks(install.botToken, {
      channel: event.channel,
      ts: event.message_ts,
      unfurls,
    });
  } catch (err) {
    // Once we've resolved the org, funnel failures into op_failures so
    // admins can see "why didn't my link unfurl?"
    await recordFailure(env.DB, {
      op: "slack.unfurl",
      ownerId: install.orgId,
      deliveryId: event.message_ts ?? null,
      error: err,
    });
  }
}

// ---- URL parsing ----

// Returns { kind: "pr" | "issue" | "feature", repo?, number } or null.
export function parseUnticketUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.host !== APP_HOST) return null;

  const parts = u.pathname.split("/").filter(Boolean);

  if (parts[0] === "prs" && parts.length === 3) {
    const number = Number(parts[2]);
    if (!Number.isFinite(number)) return null;
    return { kind: "pr", repo: parts[1], number };
  }

  if (parts[0] === "issues" && parts.length === 3) {
    const number = Number(parts[2]);
    if (!Number.isFinite(number)) return null;
    return { kind: "issue", repo: parts[1], number };
  }

  if (u.pathname === "/" || parts.length === 0) {
    const tab = u.searchParams.get("tab");
    if (tab === "sprint") {
      const f = Number(u.searchParams.get("f"));
      if (Number.isFinite(f)) return { kind: "feature", number: f };
    }
  }

  return null;
}

// ---- unfurl builders ----

async function buildUnfurl(env, orgId, target) {
  if (target.kind === "pr") return buildPrUnfurl(env, orgId, target);
  if (target.kind === "issue") return buildIssueUnfurl(env, orgId, target);
  if (target.kind === "feature") return buildFeatureUnfurl(env, orgId, target);
  return null;
}

async function buildPrUnfurl(env, orgId, { repo, number }) {
  const row = await env.DB
    .prepare(
      "SELECT title, author, state, draft, merged_at, html_url FROM pull_requests WHERE org_id = ? AND repo = ? AND number = ?",
    )
    .bind(orgId, repo, number)
    .first()
    .catch(() => null);
  if (!row) return null;

  const status = row.merged_at
    ? "merged"
    : row.state === "closed"
      ? "closed"
      : row.draft
        ? "draft"
        : "open";

  return {
    color: statusColor(status),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*PR #${number} — <${row.html_url ?? ""}|${escapeMrkdwn(row.title ?? "(untitled)")}>*` +
            `\n\`${escapeMrkdwn(repo)}\` · ${status}` +
            (row.author ? ` · by @${escapeMrkdwn(row.author)}` : ""),
        },
      },
    ],
  };
}

async function buildIssueUnfurl(env, orgId, { repo, number }) {
  const row = await env.DB
    .prepare(
      "SELECT title, state, author, assignees_json, labels_json, html_url FROM issues WHERE org_id = ? AND repo = ? AND number = ?",
    )
    .bind(orgId, repo, number)
    .first()
    .catch(() => null);
  if (!row) return null;

  const assignees = safeJsonArray(row.assignees_json)
    .map((a) => a?.login)
    .filter(Boolean);
  const labels = safeJsonArray(row.labels_json)
    .map((l) => l?.name)
    .filter(Boolean);

  const meta = [`\`${escapeMrkdwn(repo)}\``, row.state ?? "open"];
  if (assignees.length) meta.push("assigned to " + assignees.map((n) => `@${n}`).join(", "));
  else if (row.author) meta.push(`by @${row.author}`);
  if (labels.length) meta.push(labels.map((l) => `\`${escapeMrkdwn(l)}\``).join(" "));

  return {
    color: row.state === "closed" ? "#8250df" : "#1a7f37",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*Issue #${number} — <${row.html_url ?? ""}|${escapeMrkdwn(row.title ?? "(untitled)")}>*` +
            `\n${meta.join(" · ")}`,
        },
      },
    ],
  };
}

async function buildFeatureUnfurl(env, orgId, { number }) {
  const row = await env.DB
    .prepare(
      "SELECT title, state, assignees_json, labels_json, html_url FROM features WHERE org_id = ? AND number = ?",
    )
    .bind(orgId, number)
    .first()
    .catch(() => null);
  if (!row) return null;

  const owners = safeJsonArray(row.assignees_json)
    .map((a) => a?.login)
    .filter(Boolean);
  const labels = safeJsonArray(row.labels_json)
    .map((l) => l?.name)
    .filter(Boolean);

  // The kanban stage is stored as a `status:*` label. Show the raw suffix
  // ("staging", "ready", "production", "future"), or "to do" when no
  // status label is present (the implicit default).
  const status = labels.find((l) => l.startsWith("status:"))?.slice("status:".length) ?? "to do";
  const isBacklog = labels.includes("backlog");

  const meta = [status];
  if (isBacklog) meta.push("backlog");
  if (owners.length) meta.push(owners.map((n) => `@${n}`).join(", "));

  return {
    color: row.state === "closed" ? "#8250df" : "#0969da",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*Feature #${number} — <${row.html_url ?? ""}|${escapeMrkdwn(row.title ?? "(untitled)")}>*` +
            `\n${meta.join(" · ")}`,
        },
      },
    ],
  };
}

// ---- utils ----

function safeJsonArray(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function escapeMrkdwn(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

function statusColor(status) {
  switch (status) {
    case "merged": return "#8250df";
    case "closed": return "#cf222e";
    case "draft": return "#6e7781";
    default: return "#1a7f37"; // open
  }
}
