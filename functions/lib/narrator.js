// Per-event first-person narrator. Called from the webhook (waitUntil).
// One raw event in, one narrative event out. No queue, no debounce.

import { completeNarrative } from "./llm";
import { resolveLlmConfig } from "./llm-config";
import { recordFailure } from "./op-failures";
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
