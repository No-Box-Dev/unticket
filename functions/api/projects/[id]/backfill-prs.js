import { getCtx, jsonResponse, errorResponse } from "../../../lib/db";
import { getInstallationToken } from "../../../lib/github-app";
import { resolveActorFromGithub } from "../../../lib/actors";
import { narrateEvent } from "../../../lib/narrator";

// POST /api/projects/:id/backfill-prs  body: { days?: number (1..30, default 3) }
// Generates first-person posts for the last N days of PRs in the project's repo,
// one per PR, attributed to its author. Dedupes via delivery_id like
// `backfill:<projectId>:pr-<n>` so re-running is idempotent.
const BACKFILL_MAX_PRS = 25;

export async function onRequestPost(context) {
  const { orgLogin } = getCtx(context);
  if (!orgLogin) return errorResponse("Missing org context", 400);
  const { id } = context.params;
  if (!id) return errorResponse("Missing project id", 400);

  let body;
  try {
    body = await context.request.json();
  } catch {
    body = {};
  }
  const days = Math.max(1, Math.min(30, Number(body?.days) || 3));

  const db = context.env.DB;

  const project = await db.prepare(
    "SELECT id, name, org, repo, owner_id FROM projects WHERE id = ? AND owner_id = ?"
  ).bind(id, orgLogin).first();
  if (!project) return errorResponse(`Unknown project ${id}`, 404);
  if (!project.org || !project.repo) return errorResponse("Project has no org/repo", 400);

  const inst = await db.prepare(
    "SELECT installation_id FROM installations WHERE owner_id = ? AND account_login = ?"
  ).bind(orgLogin, project.org).first();
  if (!inst) return errorResponse(`No installation for org ${project.org}`, 404);

  let prs;
  try {
    prs = await fetchRecentPrs(context.env, inst.installation_id, project.org, project.repo, days);
  } catch (err) {
    return errorResponse(`Failed to fetch PRs: ${err instanceof Error ? err.message : String(err)}`, 502);
  }

  if (prs.length === 0) {
    return jsonResponse({
      ok: true,
      found: 0,
      queued: 0,
      skipped: 0,
      days,
      message: `No PRs in the last ${days} day(s).`,
    });
  }

  const existing = await db.prepare(
    `SELECT delivery_id FROM events
      WHERE owner_id = ? AND project_id = ? AND source = 'github-backfill'
        AND delivery_id LIKE ?`
  ).bind(orgLogin, project.id, `backfill:${project.id}:pr-%`).all();
  const seen = new Set((existing.results ?? []).map((r) => r.delivery_id));

  const todo = prs
    .filter((pr) => !seen.has(`backfill:${project.id}:pr-${pr.number}`))
    .slice(0, BACKFILL_MAX_PRS);

  // Sweep up narratives stamped `model='fallback'` (Zhipu was unavailable when
  // they ran — usually cron Worker missing ZHIPU_API_KEY). Backfill is the
  // natural moment to retry: the user is asking for a refresh anyway.
  const fallbackIds = await findFallbackNarrativeIds(db, orgLogin, project.id);

  if (todo.length === 0 && fallbackIds.length === 0) {
    return jsonResponse({
      ok: true,
      found: prs.length,
      queued: 0,
      skipped: prs.length,
      renarrated: 0,
      days,
      message: "All PRs already backfilled.",
    });
  }

  const work = (async () => {
    if (todo.length > 0) {
      await processBackfill(context.env, {
        projectId: project.id,
        org: project.org,
        repo: project.repo,
        ownerId: orgLogin,
        prs: todo,
      });
    }
    if (fallbackIds.length > 0) {
      await renarrateFallbacks(context.env, fallbackIds);
    }
  })();
  context.waitUntil(work.catch((err) => console.error("[unticket backfill] failed:", err)));

  return jsonResponse({
    ok: true,
    found: prs.length,
    queued: todo.length,
    skipped: prs.length - todo.length,
    renarrated: fallbackIds.length,
    days,
  });
}

async function findFallbackNarrativeIds(db, ownerId, projectId) {
  const rows = await db.prepare(
    `SELECT id, json_extract(payload_json, '$.trigger_event_id') AS trigger_event_id
       FROM events
      WHERE owner_id = ? AND project_id = ?
        AND type = 'narrative'
        AND json_extract(payload_json, '$.model') = 'fallback'`
  ).bind(ownerId, projectId).all();
  return (rows.results ?? [])
    .map((r) => ({ id: r.id, triggerEventId: r.trigger_event_id }))
    .filter((r) => r.triggerEventId != null);
}

async function renarrateFallbacks(env, fallbacks) {
  for (const { id, triggerEventId } of fallbacks) {
    try {
      await env.DB.prepare("DELETE FROM events WHERE id = ?").bind(id).run();
      await narrateEvent(env, triggerEventId);
    } catch (err) {
      console.error(`[unticket backfill] re-narrate trigger ${triggerEventId} failed:`, err);
    }
  }
}

async function fetchRecentPrs(env, installationId, org, repo, days) {
  const token = await getInstallationToken(env, installationId);
  const cutoff = Date.now() - days * 86_400_000;

  const url = `https://api.github.com/repos/${org}/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "unticket",
    },
  });
  if (!res.ok) {
    throw new Error(`fetchRecentPrs ${org}/${repo}: ${res.status}`);
  }
  const all = await res.json();
  return all.filter((pr) => {
    const anchor = pr.merged_at || pr.closed_at || pr.created_at;
    return anchor && new Date(anchor).getTime() >= cutoff;
  });
}

async function processBackfill(env, args) {
  // Oldest-first so the feed reads chronologically.
  const sorted = [...args.prs].sort((a, b) => prAnchor(a).localeCompare(prAnchor(b)));
  for (const pr of sorted) {
    try {
      await backfillOnePr(env, args, pr);
    } catch (err) {
      console.error(`[unticket backfill] PR #${pr.number} failed:`, err);
    }
  }
}

function prAnchor(pr) {
  return pr.merged_at || pr.closed_at || pr.created_at;
}

async function backfillOnePr(env, args, pr) {
  if (!pr.user?.login) return;

  const actor = await resolveActorFromGithub(env.DB, args.ownerId, {
    login: pr.user.login,
    id: pr.user.id ?? null,
    avatar_url: pr.user.avatar_url ?? null,
    type: pr.user.type === "Bot" ? "Bot" : "User",
    name: null,
  });
  if (!actor) return;

  const eventType = pr.merged_at
    ? "github:pr:merged"
    : pr.state === "closed"
      ? "github:pr:closed"
      : "github:pr:opened";

  const createdAt = prAnchor(pr);

  const result = await env.DB.prepare(
    `INSERT INTO events (delivery_id, source, type, actor_id, project_id, org, repo, summary, payload_json, owner_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(delivery_id) DO NOTHING`
  ).bind(
    `backfill:${args.projectId}:pr-${pr.number}`,
    "github-backfill",
    eventType,
    actor.id,
    args.projectId,
    args.org,
    args.repo,
    `PR #${pr.number}: ${pr.title}`,
    JSON.stringify({
      action: pr.merged_at ? "merged" : "opened",
      pr: {
        number: pr.number,
        title: pr.title,
        body: pr.body?.slice(0, 1000) ?? null,
        state: pr.state,
        merged: !!pr.merged_at,
        author: pr.user.login,
        additions: pr.additions,
        deletions: pr.deletions,
        changed_files: pr.changed_files,
      },
    }),
    args.ownerId,
    createdAt,
  ).run();

  const eventId = result.meta?.last_row_id;
  if (!eventId) return;
  await narrateEvent(env, eventId);
}
