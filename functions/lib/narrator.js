// Per-event narrators. Three voices, one PR lifecycle:
//   - narratePrOpened     → first-person "opened a PR" post (type=pr_narrative, source=pr-opened-narrator)
//   - narrateEvent        → first-person chat post           (type=narrative,    source=narrator)
//   - narrateReleaseNotes → structured release note          (type=release_notes, source=release-notes)
//
// PR opens → narratePrOpened writes a pr_narrative row → PRs feed.
// PR merges → narrateEvent + narrateReleaseNotes look up that pr_narrative row.
//   If found, they REUSE its text (no LLM call) and insert it as narrative +
//   release_notes rows. If not found (PR predates this feature or the
//   open-time narrator failed), they fall back to a fresh LLM call using
//   ACTOR_SYSTEM / RELEASE_NOTES_SYSTEM. Net cost: 1 LLM call per PR
//   lifecycle instead of 2, and the same text moves through all three feeds.
//
// All three share the org's LLM config (BYOK setting applies to all). Runs at
// every trigger point: webhook, cron queue handler, reconcile loop —
// see the trigger-point list in CLAUDE.md ("Narration" / "Live Activity events").

import { completeNarrative } from "./llm";
import { resolveLlmConfig } from "./llm-config";
import { recordFailure } from "./op-failures";
import {
  ACTOR_SYSTEM,
  buildActorMessage,
  PR_OPENED_SYSTEM,
  buildPrOpenedMessage,
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

// Merge-time narration gate — narrateEvent + narrateReleaseNotes. Keep in
// sync with POST_TRIGGER_TYPES in src/hooks/useNoxlink.ts (the client-side
// filter that must match this list so we don't render narratives triggered
// by types the server also skips).
export const NARRATABLE_TYPES = ["github:pr:merged"];

// Open-time narration gate — narratePrOpened. Fires the PRs feed. The
// resulting pr_narrative row is looked up (and its text reused) by the
// merge-time narrators when the PR eventually merges.
export const NARRATABLE_TYPES_OPENED = ["github:pr:opened"];

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

  // PR identity is the dedup unit, not trigger_event_id. GitHub redelivers
  // webhooks (auto-retry, network blips, ...) and each delivery becomes a
  // fresh trigger event — narrating each one produces N posts for the same
  // PR. The UNIQUE INDEX in migration 0033 is on
  // (owner_id, repo, type, pr_number); we read pr_number here once for both
  // the early-exit SELECT (skip LLM spend when a row already exists) and
  // the INSERT payload (denormalize so the index expression is cheap).
  const triggerPayload = safeParseObject(row.payload_json);
  const prNumber = triggerPayload?.pr?.number;
  if (typeof prNumber !== "number") return; // pr-merged events always carry pr.number

  const existing = await env.DB.prepare(
    `SELECT id FROM events
       WHERE owner_id = ? AND repo = ? AND type = 'narrative'
         AND CAST(json_extract(payload_json, '$.pr_number') AS INTEGER) = ?
       LIMIT 1`
  ).bind(row.owner_id, row.repo, prNumber).first();
  if (existing) return;

  // Reuse-text path: if this PR was already narrated at open time, use that
  // text instead of paying for a second LLM call. See narratePrOpened for how
  // the pr_narrative row lands. Falls through to a fresh LLM call for PRs that
  // predate this feature (no pr_narrative row) or where the open-time
  // narration failed (row missing, or fallback-only).
  const orgId = await resolveOrgId(env.DB, row.owner_id);
  const reused = await findExistingPrNarrative(env.DB, row.owner_id, row.repo, prNumber);
  let summary;
  let model;
  let source;
  if (reused) {
    summary = reused.summary;
    model = `reused:${reused.model}`;
    source = "narrator-reused";
  } else {
    const userMessage = buildActorMessage({
      actorName: actor.name,
      actorTone: actor.tone,
      projectName: project.name,
      event: {
        type: row.type,
        summary: row.summary,
        payload: triggerPayload,
        created_at: row.created_at,
      },
    });
    // Per-org override (BYOK) wins; default falls back to env.ZHIPU_API_KEY.
    const llmConfig = await resolveLlmConfig(env, orgId);
    const text = await completeNarrative(llmConfig, ACTOR_SYSTEM, userMessage);
    source = "narrator";

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
  }

  // ON CONFLICT DO NOTHING relies on the partial UNIQUE INDEX from
  // migration 0033 — (owner_id, repo, type, pr_number) for narration rows.
  // The early-exit SELECT above short-circuits ~all duplicates before LLM
  // spend; this clause is the at-most-once guarantee for concurrent
  // writers that both pass the SELECT.
  const insertResult = await env.DB.prepare(
    `INSERT INTO events (source, type, actor_id, project_id, org, repo, summary, payload_json, owner_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`
  ).bind(
    source,
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
      pr_number: prNumber,
    }),
    row.owner_id,
    row.created_at,
  ).run();

  // If the unique index suppressed the insert, another concurrent narrator
  // already produced (or is producing) the row for this trigger — skip the
  // Slack mirror so we don't double-post.
  if ((insertResult.meta?.changes ?? 0) === 0) return;

  // Slack mirror — fire after the D1 write so a Slack outage never blocks
  // the in-app feed. Failures are recorded to op_failures (admin-visible)
  // and swallowed; the narrative row is already durable.
  //
  // When we're reusing the pr_narrative text, the SAME text was already
  // posted to the Posts Slack channel by narratePrOpened at PR-open time.
  // Posting it again here — with a different D1 row but identical Slack
  // payload — reads as duplicate noise. Rule of thumb we now follow: one
  // Slack post per LLM call. Reused rows spent no tokens, so they don't
  // get a Slack post either.
  if (reused) return;
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

  // PR identity dedup — see narrateEvent's comment for why we don't index
  // on trigger_event_id (webhook redeliveries create fresh trigger events
  // for the same PR).
  const triggerPayload = safeParseObject(row.payload_json);
  const prNumber = triggerPayload?.pr?.number;
  if (typeof prNumber !== "number") return;

  const existing = await env.DB.prepare(
    `SELECT id FROM events
       WHERE owner_id = ? AND repo = ? AND type = 'release_notes'
         AND CAST(json_extract(payload_json, '$.pr_number') AS INTEGER) = ?
       LIMIT 1`
  ).bind(row.owner_id, row.repo, prNumber).first();
  if (existing) return;

  // Reuse-text path (see narrateEvent for the full reasoning). If an
  // pr_narrative row exists for this PR, use its text and skip the LLM
  // call. Release notes lose their structured format when reused — that's
  // the trade-off for "one LLM call total per PR lifecycle". If admins
  // want the structured format back, they can delete the pr_narrative
  // row and re-run the merge narrator (fresh LLM call, structured output).
  const orgId = await resolveOrgId(env.DB, row.owner_id);
  const reused = await findExistingPrNarrative(env.DB, row.owner_id, row.repo, prNumber);
  let summary;
  let model;
  let source;
  if (reused) {
    summary = reused.summary;
    model = `reused:${reused.model}`;
    source = "release-notes-reused";
  } else {
    const userMessage = buildReleaseNotesMessage({
      actorName: actor.name,
      projectName: project.name,
      event: {
        type: row.type,
        summary: row.summary,
        payload: triggerPayload,
        created_at: row.created_at,
      },
    });

    const [llmConfig, systemPrompt] = await Promise.all([
      resolveLlmConfig(env, orgId),
      resolveReleaseNotesPrompt(env.DB, orgId),
    ]);
    const text = await completeNarrative(llmConfig, systemPrompt, userMessage);
    source = "release-notes";

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
  }

  // Same ON CONFLICT pattern as narrateEvent — migration 0033 holds the
  // partial UNIQUE INDEX on (owner_id, repo, type, pr_number).
  const insertResult = await env.DB.prepare(
    `INSERT INTO events (source, type, actor_id, project_id, org, repo, summary, payload_json, owner_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`
  ).bind(
    source,
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
      pr_number: prNumber,
    }),
    row.owner_id,
    row.created_at,
  ).run();

  // Suppress the Slack mirror when the unique index ate the insert — a
  // concurrent writer already produced this release note.
  if ((insertResult.meta?.changes ?? 0) === 0) return;

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

// Sibling to narrateEvent, but fires on PR *open* rather than merge. Writes
// the first-person "just opened a PR" post that shows up in the PRs feed
// (type='pr_narrative'). The same text is reused by narrateEvent +
// narrateReleaseNotes when the PR later merges (findExistingPrNarrative
// below), so ONE LLM call covers the whole PR lifecycle instead of two.
export async function narratePrOpened(env, eventId) {
  const row = await env.DB.prepare(
    `SELECT id, type, actor_id, project_id, org, repo, owner_id, summary, payload_json, created_at
     FROM events WHERE id = ?`
  ).bind(eventId).first();
  if (!row) return;
  if (!NARRATABLE_TYPES_OPENED.includes(row.type)) return;
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

  // PR-identity dedup — see narrateEvent's comment. Same partial UNIQUE INDEX
  // from migration 0033 (extended by 0035 to cover pr_narrative), so concurrent
  // writers can't produce two pr_narrative rows for the same PR.
  const triggerPayload = safeParseObject(row.payload_json);
  const prNumber = triggerPayload?.pr?.number;
  if (typeof prNumber !== "number") return;

  const existing = await env.DB.prepare(
    `SELECT id FROM events
       WHERE owner_id = ? AND repo = ? AND type = 'pr_narrative'
         AND CAST(json_extract(payload_json, '$.pr_number') AS INTEGER) = ?
       LIMIT 1`
  ).bind(row.owner_id, row.repo, prNumber).first();
  if (existing) return;

  const userMessage = buildPrOpenedMessage({
    actorName: actor.name,
    actorTone: actor.tone,
    projectName: project.name,
    event: {
      type: row.type,
      summary: row.summary,
      payload: triggerPayload,
      created_at: row.created_at,
    },
  });

  const orgId = await resolveOrgId(env.DB, row.owner_id);
  const llmConfig = await resolveLlmConfig(env, orgId);
  const text = await completeNarrative(llmConfig, PR_OPENED_SYSTEM, userMessage);

  let summary;
  let model;
  if (text) {
    const trimmed = text.trim();
    summary = trimmed.length > MAX_OUTPUT_LENGTH
      ? trimmed.slice(0, MAX_OUTPUT_LENGTH - 1).trimEnd() + "…"
      : trimmed;
    model = llmConfig.model;
  } else {
    if (!row.summary) return;
    summary = row.summary;
    model = "fallback";
    await recordFailure(env.DB, {
      ownerId: row.owner_id,
      op: "narratePrOpened",
      deliveryId: `event-${row.id}`,
      error: `LLM (${llmConfig.source}: ${llmConfig.provider}/${llmConfig.model}) returned no text`,
    });
  }

  const insertResult = await env.DB.prepare(
    `INSERT INTO events (source, type, actor_id, project_id, org, repo, summary, payload_json, owner_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`
  ).bind(
    "pr-opened-narrator",
    "pr_narrative",
    actor.id,
    row.project_id,
    row.org,
    row.repo,
    summary,
    JSON.stringify({
      trigger_event_id: row.id,
      trigger_type: row.type,
      model,
      pr_number: prNumber,
    }),
    row.owner_id,
    row.created_at,
  ).run();

  if ((insertResult.meta?.changes ?? 0) === 0) return;

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

// Look up the existing pr_narrative row (if any) for this PR. Used by both
// merge-time narrators to reuse the open-time text instead of paying for a
// fresh LLM call. Returns null if no row exists OR if the existing row is a
// 'fallback' (raw summary because LLM was unavailable at open time) — in the
// latter case the merge-time narrator falls through to a fresh LLM call so
// the feed doesn't stay stuck on the raw title.
async function findExistingPrNarrative(db, ownerId, repo, prNumber) {
  const row = await db.prepare(
    `SELECT summary, json_extract(payload_json, '$.model') AS model
       FROM events
       WHERE owner_id = ? AND repo = ? AND type = 'pr_narrative'
         AND CAST(json_extract(payload_json, '$.pr_number') AS INTEGER) = ?
       LIMIT 1`
  ).bind(ownerId, repo, prNumber).first();
  if (!row?.summary) return null;
  if (row.model === "fallback") return null;
  return { summary: row.summary, model: row.model ?? "unknown" };
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
