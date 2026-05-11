// Per-event first-person narrator. Called from the webhook (waitUntil).
// One raw event in, one narrative event out. No queue, no debounce.

import { completeNarrative, NARRATOR_MODEL } from "./llm";
import { ACTOR_SYSTEM, buildActorMessage } from "./prompt";

const MAX_OUTPUT_LENGTH = 800;

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

  const note = await env.DB.prepare(
    "SELECT note FROM actor_repo_notes WHERE actor_id = ? AND project_id = ?"
  ).bind(actor.id, row.project_id).first();

  const userMessage = buildActorMessage({
    actorName: actor.name,
    actorTone: actor.tone,
    projectName: project.name,
    repoNote: note?.note ?? null,
    event: {
      type: row.type,
      summary: row.summary,
      payload: safeParseObject(row.payload_json),
      created_at: row.created_at,
    },
  });

  const text = await completeNarrative(env.ZHIPU_API_KEY, ACTOR_SYSTEM, userMessage);

  let summary;
  let model;
  if (text) {
    const trimmed = text.trim();
    // SKIP is a deliberate signal from the LLM that this event isn't worth surfacing.
    // Honor it instead of falling back, so noise the model wanted filtered stays filtered.
    if (trimmed === "SKIP" || trimmed.startsWith("SKIP\n") || trimmed.startsWith("SKIP ")) return;
    summary = trimmed.length > MAX_OUTPUT_LENGTH
      ? trimmed.slice(0, MAX_OUTPUT_LENGTH - 1).trimEnd() + "…"
      : trimmed;
    model = NARRATOR_MODEL;
  } else {
    // Zhipu unavailable (no key, timeout, HTTP error). Surface the raw event
    // summary (e.g. "PR #42: title") so the feed isn't empty when the LLM is down.
    if (!row.summary) return;
    summary = row.summary;
    model = "fallback";
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
