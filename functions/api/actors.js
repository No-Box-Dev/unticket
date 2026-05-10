import { getCtx, jsonResponse, errorResponse } from "../lib/db";
import { DEFAULT_ACTOR_TONE } from "../lib/actors";

// GET /api/actors — list actors visible to this org.
// Joins gh_users (mirror identity) with actors (overlay). COALESCE picks
// overlay when present, mirror as fallback. Synthesized id 'actor_<login>'
// for mirror-only rows so the dashboard can link before any overlay edits.
export async function onRequestGet(context) {
  const { orgLogin } = getCtx(context);
  if (!orgLogin) return errorResponse("Missing org context", 400);

  const rows = await context.env.DB.prepare(
    `SELECT
        COALESCE(a.id, 'actor_' || u.login)             AS id,
        u.login                                         AS github_login,
        COALESCE(a.github_user_id, CAST(u.id AS TEXT))  AS github_user_id,
        COALESCE(NULLIF(a.name, ''), u.name, u.login)   AS name,
        COALESCE(a.avatar_url, u.avatar_url)            AS avatar_url,
        COALESCE(NULLIF(a.tone, ''), ?)                 AS tone,
        COALESCE(a.kind, CASE WHEN u.type = 'Bot' THEN 'bot' ELSE 'human' END) AS kind,
        ?                                               AS owner_id,
        COALESCE(a.created_at, u.synced_at)             AS created_at,
        COALESCE(a.updated_at, u.synced_at)             AS updated_at
     FROM gh_users u
     LEFT JOIN actors a ON a.owner_id = ? AND a.github_user_id = CAST(u.id AS TEXT)
     WHERE u.id IN (
       SELECT m.gh_user_id FROM gh_members m
       JOIN installations i ON i.installation_id = m.installation_id
       WHERE i.owner_id = ?
     )
     UNION
     SELECT a.id, NULL AS github_login, a.github_user_id, a.name, a.avatar_url,
            COALESCE(NULLIF(a.tone, ''), ?) AS tone,
            a.kind, a.owner_id, a.created_at, a.updated_at
     FROM actors a
     WHERE a.owner_id = ?
       AND (
         a.github_user_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM gh_users u WHERE CAST(u.id AS TEXT) = a.github_user_id)
       )
     ORDER BY name`
  ).bind(
    DEFAULT_ACTOR_TONE,
    orgLogin,
    orgLogin,
    orgLogin,
    DEFAULT_ACTOR_TONE,
    orgLogin,
  ).all();

  return jsonResponse({ actors: rows.results ?? [] });
}
