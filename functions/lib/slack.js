// Slack posting for the Posts and Release-notes feeds via a single shared
// Unticket Slack app.
//
// Per-org install: each workspace's bot token + team metadata lives in the
// `slack_settings` table (token encrypted with ENCRYPTION_KEY). The Settings
// JSON carries only the public per-feed channel selections under
// settings.slack.{postsChannelId, releaseNotesChannelId}.
//
// Auth model: the admin clicks "Connect Slack" in Settings → OAuth dance →
// callback stores the bot token. Posting uses `chat.postMessage` against
// that token rather than the webhook URLs the v1 of this feature used.

import { decryptToken, encryptToken } from "./crypto";

const SLACK_API = "https://slack.com";
const TIMEOUT_MS = 5000;

// ---------- Storage ----------

/**
 * Load the encrypted bot token for an org and decrypt in memory. Returns:
 *   { teamId, teamName, botUserId, botToken } — fully provisioned
 *   null                                      — not connected OR no key
 *
 * A corrupt row is treated as "not connected" so a single bad install
 * never wedges the feed.
 */
export async function resolveSlackInstall(env, orgId) {
  const db = env?.DB;
  if (!db || !orgId) return null;
  const row = await db
    .prepare(
      "SELECT team_id, team_name, bot_user_id, encrypted_bot_token FROM slack_settings WHERE org_id = ?",
    )
    .bind(orgId)
    .first()
    .catch(() => null);
  if (!row?.encrypted_bot_token) return null;
  if (!env.ENCRYPTION_KEY) return null;
  try {
    const botToken = await decryptToken(row.encrypted_bot_token, env.ENCRYPTION_KEY);
    if (!botToken) return null;
    return {
      teamId: row.team_id,
      teamName: row.team_name ?? null,
      botUserId: row.bot_user_id ?? null,
      botToken,
    };
  } catch {
    return null;
  }
}

export async function saveSlackInstall(env, orgId, install) {
  if (!env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY missing");
  const encrypted = await encryptToken(install.botToken, env.ENCRYPTION_KEY);

  // Wipe channel selections if this is a NEW install or a switch to a
  // different workspace — the old channel IDs are workspace-scoped and
  // would route narration to the wrong place (or fail with channel_not_found).
  const existing = await env.DB
    .prepare("SELECT team_id FROM slack_settings WHERE org_id = ?")
    .bind(orgId)
    .first()
    .catch(() => null);
  if (!existing || existing.team_id !== install.teamId) {
    await clearSlackChannelsForOrg(env.DB, orgId);
  }

  await env.DB.prepare(
    `INSERT INTO slack_settings (org_id, team_id, team_name, bot_user_id, encrypted_bot_token, installed_by, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
     ON CONFLICT(org_id) DO UPDATE SET
       team_id = excluded.team_id,
       team_name = excluded.team_name,
       bot_user_id = excluded.bot_user_id,
       encrypted_bot_token = excluded.encrypted_bot_token,
       installed_by = excluded.installed_by,
       installed_at = excluded.installed_at`,
  )
    .bind(orgId, install.teamId, install.teamName ?? null, install.botUserId ?? null, encrypted, install.installedBy)
    .run();
}

export async function deleteSlackInstall(env, orgId) {
  // Drop channel selections too — they reference a workspace that no
  // longer has a bot token, so leaving them would either silently fail or
  // route to the wrong workspace if the admin re-connects elsewhere.
  await clearSlackChannelsForOrg(env.DB, orgId);
  await env.DB.prepare("DELETE FROM slack_settings WHERE org_id = ?").bind(orgId).run();
}

// ---------- Per-org settings.slack.* (channels) ----------

export async function resolveSlackChannels(db, orgId) {
  if (!db || !orgId) return { postsChannelId: "", releaseNotesChannelId: "" };
  const row = await db
    .prepare("SELECT data FROM config WHERE org_id = ? AND key = 'settings'")
    .bind(orgId)
    .first()
    .catch(() => null);
  if (!row?.data) return { postsChannelId: "", releaseNotesChannelId: "" };
  let settings;
  try { settings = JSON.parse(row.data); } catch { return { postsChannelId: "", releaseNotesChannelId: "" }; }
  const slack = settings?.slack;
  if (!slack || typeof slack !== "object") return { postsChannelId: "", releaseNotesChannelId: "" };
  return {
    postsChannelId: typeof slack.postsChannelId === "string" ? slack.postsChannelId.trim() : "",
    releaseNotesChannelId: typeof slack.releaseNotesChannelId === "string" ? slack.releaseNotesChannelId.trim() : "",
  };
}

// ---------- Slack Web API client ----------

async function slackPost(token, endpoint, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${SLACK_API}/api/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`Slack HTTP ${res.status} ${res.statusText}`);
  }
  // Slack Web API always returns 200 with `ok: false` on logical errors.
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack ${endpoint}: ${data.error ?? "unknown error"}`);
  }
  return data;
}

async function slackGet(token, endpoint, params = {}) {
  const url = new URL(`${SLACK_API}/api/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Slack HTTP ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${endpoint}: ${data.error ?? "unknown error"}`);
  return data;
}

// Post a Block Kit message to a channel. Throws on Slack error.
export function postSlackMessage(token, channelId, payload) {
  return slackPost(token, "chat.postMessage", { channel: channelId, ...payload });
}

// List public + private channels the bot has access to. Auto-paginates up
// to 1000 channels (Slack's default page is 100). Returns
//   [{ id, name, is_private, is_archived, is_member }, ...]
export async function listSlackChannels(token) {
  const out = [];
  let cursor;
  for (let page = 0; page < 10; page++) {
    const data = await slackGet(token, "conversations.list", {
      types: "public_channel,private_channel",
      limit: 200,
      exclude_archived: true,
      cursor,
    });
    for (const c of data.channels ?? []) {
      out.push({
        id: c.id,
        name: c.name,
        is_private: !!c.is_private,
        is_archived: !!c.is_archived,
        is_member: !!c.is_member,
      });
    }
    cursor = data.response_metadata?.next_cursor;
    if (!cursor) break;
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ---------- OAuth helpers ----------

const REDIRECT_PATH = "/api/slack/oauth/callback";
const BOT_SCOPES = ["channels:read", "groups:read", "chat:write", "chat:write.public"];

export function buildOAuthAuthorizeUrl(clientId, origin, state) {
  const u = new URL(`${SLACK_API}/oauth/v2/authorize`);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("scope", BOT_SCOPES.join(","));
  u.searchParams.set("redirect_uri", `${origin}${REDIRECT_PATH}`);
  u.searchParams.set("state", state);
  return u.toString();
}

// Exchange the OAuth code for a bot token + team metadata. Throws on any
// Slack-side failure so the callback can surface a clean error page.
// Credentials go in the form-encoded body, not the URL, so intermediaries
// don't log the client_secret in access logs. Wraps the fetch in the same
// 5s AbortController pattern the rest of this file uses.
export async function exchangeOAuthCode({ clientId, clientSecret, code, redirectUri }) {
  const params = new URLSearchParams();
  params.set("client_id", clientId);
  params.set("client_secret", clientSecret);
  params.set("code", code);
  params.set("redirect_uri", redirectUri);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${SLACK_API}/api/oauth.v2.access`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Slack HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack oauth.v2.access: ${data.error ?? "unknown"}`);
  if (!data.access_token || !data.team?.id) {
    throw new Error("Slack oauth.v2.access returned no bot token / team id");
  }
  return {
    botToken: data.access_token,
    botUserId: data.bot_user_id ?? null,
    teamId: data.team.id,
    teamName: data.team.name ?? null,
  };
}

// HMAC-SHA256 the state payload with the Slack client secret so a callback
// can't be tricked into trusting a forged orgId. The cookie comparison
// alone is fine for CSRF (HttpOnly + Lax), but signing the payload is a
// belt-and-braces gate against any future regression in cookie handling.
export async function signOAuthState(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time HMAC verify so a callback can recover orgId + user from a
// signed state without trusting the URL alone. Returns the parsed payload
// or null on mismatch / malformed input.
export async function verifyOAuthState(secret, state) {
  if (typeof state !== "string") return null;
  const idx = state.lastIndexOf(".");
  if (idx <= 0) return null;
  const payload = state.slice(0, idx);
  const sig = state.slice(idx + 1);
  const expected = await signOAuthState(secret, payload);
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  // payload format: `<nonce>:<orgId>:<userLogin>`
  const parts = payload.split(":");
  if (parts.length < 3) return null;
  const orgId = Number(parts[1]);
  if (!Number.isFinite(orgId) || orgId <= 0) return null;
  return { orgId, userLogin: parts.slice(2).join(":") };
}

// Wipe channel selections from settings.slack when the install changes
// workspace OR is disconnected. Channel IDs are workspace-scoped — leaving
// them around after a switch would route narration to the wrong place.
export async function clearSlackChannelsForOrg(db, orgId) {
  if (!db || !orgId) return;
  const row = await db
    .prepare("SELECT data FROM config WHERE org_id = ? AND key = 'settings'")
    .bind(orgId)
    .first()
    .catch(() => null);
  if (!row?.data) return;
  let settings;
  try { settings = JSON.parse(row.data); } catch { return; }
  if (!settings?.slack) return;
  delete settings.slack.postsChannelId;
  delete settings.slack.releaseNotesChannelId;
  if (!settings.slack.postsChannelId && !settings.slack.releaseNotesChannelId) {
    delete settings.slack;
  }
  await db
    .prepare(
      `INSERT INTO config (org_id, key, data, updated_at)
       VALUES (?, 'settings', ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
       ON CONFLICT(org_id, key) DO UPDATE SET data = excluded.data,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
    )
    .bind(orgId, JSON.stringify(settings))
    .run();
}

// ---------- Block Kit builders (carried over from v1) ----------

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

function escapeMrkdwn(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

function stripForFallback(s) {
  return truncate(String(s ?? "").replace(/\s+/g, " ").trim(), 140);
}

function truncate(s, max) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function sanitizeForCodeFence(s) {
  return String(s ?? "").replace(/`{3,}/g, (m) => m.split("").join("​"));
}
