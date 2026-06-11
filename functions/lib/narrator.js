// Per-event narrators. Two voices ride the same raw event:
//   - narrateEvent       → first-person chat post  (type=narrative,    source=narrator)
//   - narrateReleaseNotes → structured release note (type=release_notes, source=release-notes)
//
// Both share the org's LLM config (BYOK setting applies to both) and the
// same NARRATABLE_TYPES gate, so the Posts feed and Release-notes feed can
// never drift to different models. They run in parallel after every webhook
// merge, reconcile insert, and backfill PR — see the trigger-point list in
// CLAUDE.md ("Webhooks" / "Live Activity events").

import { completeNarrative } from "./llm";
import { resolveLlmConfig } from "./llm-config";
import { recordFailure } from "./op-failures";
import {
  ACTOR_SYSTEM,
  buildActorMessage,
  RELEASE_NOTES_SYSTEM,
  buildReleaseNotesMessage,
} from "./prompt";
import {
  resolveSlackInstall,
  resolveSlackChannels,
  postSlackMessage,
  buildPostsBlocks,
  buildReleaseNotesBlocks,
} from "./slack";

const MAX_OUTPUT_LENGTH = 800;
// Release notes are inherently more verbose than chat posts (structured
// sections + recommendations). Give them a bigger budget so multi-line
// notes don't get truncated mid-sentence.
const RELEASE_NOTES_MAX_OUTPUT_LENGTH = 2400;

// Only narrate "shipped" events. Opens, reviews, comments, pushes etc. crowd
// the feed and burn LLM tokens on posts the Posts tab now filters out anyway.
// Issue closes are excluded because a closing PR already produces its own
// pr:merged narrative — two cards about the same work read as a duplicate.
// Keep this list in sync with usePosts() in src/hooks/useNoxlink.ts.
export const NARRATABLE_TYPES = ["github:pr:merged"];

export async function narrateEvent(env, eventId) {
  const row = await env.DB.prepare(
    `SELECT id, type, actor_id, project_id, org, repo, owner_id, summary, payload_json, created_at
     FROM events WHERE id = ?`
  ).bind(eventId).first();
  if (!row) return;
  if (!NARRATABLE_TYPES.includes(row.type)) return;
  if (!row.actor_id || !row.project_id || !row.owner_id) return;

  const project = await env.DB.prepare(
    "SELECT name, narrator_enabled FROM projects WHERE id = ? AND owner_id = ?"
  ).bind(row.project_id, row.owner_id).first();
  if (!project) return;
  if (project.narrator_enabled === 0) return;

  const actor = await env.DB.prepare(
    "SELECT id, name, tone FROM actors WHERE id = ? AND owner_id = ?"
  ).bind(row.actor_id, row.owner_id).first();
  if (!actor) return;

  const userMessage = buildActorMessage({
    actorName: actor.name,
    actorTone: actor.tone,
    projectName: project.name,
    event: {
      type: row.type,
      summary: row.summary,
      payload: safeParseObject(row.payload_json),
      created_at: row.created_at,
    },
  });

  // Per-org override (BYOK) wins; default falls back to env.ZHIPU_API_KEY.
  const orgId = await resolveOrgId(env.DB, row.owner_id);
  const llmConfig = await resolveLlmConfig(env, orgId);
  const text = await completeNarrative(llmConfig, ACTOR_SYSTEM, userMessage);

  let summary;
  let model;
  if (text) {
    const trimmed = text.trim();
    summary = trimmed.length > MAX_OUTPUT_LENGTH
      ? trimmed.slice(0, MAX_OUTPUT_LENGTH - 1).trimEnd() + "…"
      : trimmed;
    model = llmConfig.model;
  } else {
    // LLM unavailable (no key, timeout, HTTP error, model rejected the
    // request). Keep the feed populated with the raw summary so the trigger
    // event is visible, AND record a row in op_failures so admins see *why*
    // the narrator skipped — important for BYOK debugging (bad key, wrong
    // model name) rather than failing silently and forever.
    if (!row.summary) return;
    summary = row.summary;
    model = "fallback";
    await recordFailure(env.DB, {
      ownerId: row.owner_id,
      op: "narrateEvent",
      deliveryId: `event-${row.id}`,
      error: `LLM (${llmConfig.source}: ${llmConfig.provider}/${llmConfig.model}) returned no text`,
    });
  }

  await env.DB.prepare(
    `INSERT INTO events (source, type, actor_id, project_id, org, repo, summary, payload_json, owner_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    "narrator",
    "narrative",
    actor.id,
    row.project_id,
    row.org,
    row.repo,
    summary,
    JSON.stringify({
      trigger_event_id: row.id,
      trigger_type: row.type,
      model,
    }),
    row.owner_id,
    row.created_at,
  ).run();

  // Slack mirror — fire after the D1 write so a Slack outage never blocks
  // the in-app feed. Failures are recorded to op_failures (admin-visible)
  // and swallowed; the narrative row is already durable.
  await maybePostToSlack(env, {
    kind: "narrative",
    orgId,
    ownerId: row.owner_id,
    triggerEventId: row.id,
    actor: { id: actor.id, name: actor.name },
    project,
    summary,
    rawEvent: row,
  });
}

// Sibling to narrateEvent — same gates, same LLM config, different prompt
// and different stored row (type=release_notes). Always call this after
// (or alongside) narrateEvent so the two feeds stay in lockstep.
export async function narrateReleaseNotes(env, eventId) {
  const row = await env.DB.prepare(
    `SELECT id, type, actor_id, project_id, org, repo, owner_id, summary, payload_json, created_at
     FROM events WHERE id = ?`
  ).bind(eventId).first();
  if (!row) return;
  if (!NARRATABLE_TYPES.includes(row.type)) return;
  if (!row.actor_id || !row.project_id || !row.owner_id) return;

  const project = await env.DB.prepare(
    "SELECT name, narrator_enabled FROM projects WHERE id = ? AND owner_id = ?"
  ).bind(row.project_id, row.owner_id).first();
  if (!project) return;
  if (project.narrator_enabled === 0) return;

  const actor = await env.DB.prepare(
    "SELECT id, name, tone FROM actors WHERE id = ? AND owner_id = ?"
  ).bind(row.actor_id, row.owner_id).first();
  if (!actor) return;

  // Skip if a release-note for this trigger already exists — keeps the
  // backfill loop idempotent without per-row delivery_id.
  const existing = await env.DB.prepare(
    `SELECT id FROM events
       WHERE owner_id = ? AND type = 'release_notes'
         AND CAST(json_extract(payload_json, '$.trigger_event_id') AS INTEGER) = ?
       LIMIT 1`
  ).bind(row.owner_id, row.id).first();
  if (existing) return;

  const userMessage = buildReleaseNotesMessage({
    actorName: actor.name,
    projectName: project.name,
    event: {
      type: row.type,
      summary: row.summary,
      payload: safeParseObject(row.payload_json),
      created_at: row.created_at,
    },
  });

  const orgId = await resolveOrgId(env.DB, row.owner_id);
  const [llmConfig, systemPrompt] = await Promise.all([
    resolveLlmConfig(env, orgId),
    resolveReleaseNotesPrompt(env.DB, orgId),
  ]);
  const text = await completeNarrative(llmConfig, systemPrompt, userMessage);

  let summary;
  let model;
  if (text) {
    const trimmed = text.trim();
    summary = trimmed.length > RELEASE_NOTES_MAX_OUTPUT_LENGTH
      ? trimmed.slice(0, RELEASE_NOTES_MAX_OUTPUT_LENGTH - 1).trimEnd() + "…"
      : trimmed;
    model = llmConfig.model;
  } else {
    if (!row.summary) return;
    summary = row.summary;
    model = "fallback";
    await recordFailure(env.DB, {
      ownerId: row.owner_id,
      op: "narrateReleaseNotes",
      deliveryId: `event-${row.id}`,
      error: `LLM (${llmConfig.source}: ${llmConfig.provider}/${llmConfig.model}) returned no text`,
    });
  }

  await env.DB.prepare(
    `INSERT INTO events (source, type, actor_id, project_id, org, repo, summary, payload_json, owner_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    "release-notes",
    "release_notes",
    actor.id,
    row.project_id,
    row.org,
    row.repo,
    summary,
    JSON.stringify({
      trigger_event_id: row.id,
      trigger_type: row.type,
      model,
    }),
    row.owner_id,
    row.created_at,
  ).run();

  await maybePostToSlack(env, {
    kind: "release_notes",
    orgId,
    ownerId: row.owner_id,
    triggerEventId: row.id,
    actor: { id: actor.id, name: actor.name },
    project,
    summary,
    rawEvent: row,
  });
}

// Mirror a narration to Slack via the org's installed Unticket bot. Resolves
// the bot token from slack_settings and the per-feed channel id from
// settings.slack.{postsChannelId,releaseNotesChannelId}. Any failure is
// recorded to op_failures and swallowed — the in-app feed already has the
// row, Slack downtime never blocks the queue.
async function maybePostToSlack(env, args) {
  const { kind, orgId, ownerId, triggerEventId, actor, project, summary, rawEvent } = args;
  try {
    const [install, channels] = await Promise.all([
      resolveSlackInstall(env, orgId),
      resolveSlackChannels(env.DB, orgId),
    ]);
    if (!install) return;
    const channelId = kind === "release_notes" ? channels.releaseNotesChannelId : channels.postsChannelId;
    if (!channelId) return;

    const payload = safeParseObject(rawEvent.payload_json);
    const pr = payload?.pr && typeof payload.pr === "object" ? payload.pr : null;
    const prNumber = typeof pr?.number === "number" ? pr.number : null;
    const prUrl = prNumber && rawEvent.org && rawEvent.repo
      ? `https://github.com/${rawEvent.org}/${rawEvent.repo}/pull/${prNumber}`
      : null;

    let blocks;
    if (kind === "release_notes") {
      blocks = buildReleaseNotesBlocks({
        projectName: project?.name ?? rawEvent.repo,
        summary,
        prUrl,
        prNumber,
      });
    } else {
      const avatarUrl = await fetchActorAvatar(env.DB, actor.id, ownerId);
      blocks = buildPostsBlocks({
        actorName: actor.name,
        avatarUrl,
        projectName: project?.name ?? rawEvent.repo,
        summary,
        prUrl,
        prNumber,
      });
    }
    await postSlackMessage(install.botToken, channelId, blocks);
  } catch (err) {
    await recordFailure(env.DB, {
      ownerId,
      op: kind === "release_notes" ? "slackPostReleaseNotes" : "slackPostNarrative",
      deliveryId: `event-${triggerEventId}`,
      error: err,
    }).catch(() => {});
  }
}

async function fetchActorAvatar(db, actorId, ownerId) {
  if (!db || !actorId || !ownerId) return null;
  try {
    const row = await db
      .prepare("SELECT avatar_url FROM actors WHERE id = ? AND owner_id = ?")
      .bind(actorId, ownerId)
      .first();
    return typeof row?.avatar_url === "string" ? row.avatar_url : null;
  } catch {
    return null;
  }
}

// Per-org override of the release-notes system prompt, stored in
// config.settings.releaseNotesPrompt. Falls back to the bundled default
// (RELEASE_NOTES_SYSTEM) when no row, empty string, or corrupt JSON.
async function resolveReleaseNotesPrompt(db, orgId) {
  if (!db || !orgId) return RELEASE_NOTES_SYSTEM;
  try {
    const row = await db
      .prepare("SELECT data FROM config WHERE org_id = ? AND key = 'settings'")
      .bind(orgId)
      .first();
    if (!row?.data) return RELEASE_NOTES_SYSTEM;
    const settings = JSON.parse(row.data);
    const custom = typeof settings?.releaseNotesPrompt === "string"
      ? settings.releaseNotesPrompt.trim()
      : "";
    return custom || RELEASE_NOTES_SYSTEM;
  } catch {
    return RELEASE_NOTES_SYSTEM;
  }
}

async function resolveOrgId(db, ownerId) {
  if (!db || !ownerId) return null;
  const row = await db
    .prepare("SELECT id FROM orgs WHERE github_login = ?")
    .bind(ownerId)
    .first()
    .catch(() => null);
  return row?.id ?? null;
}

function safeParseObject(s) {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
