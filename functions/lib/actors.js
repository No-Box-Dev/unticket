// Actor resolution. One row per (owner, github user) — keyed by GitHub's
// stable numeric id. Mirror tables (gh_users) own identity; actors holds
// per-owner overlay (custom name, avatar, tone, kind). Webhook handlers
// call resolveActorFromGithub on every author so the row exists by the
// time the narrator looks for tone.
//
// Ported from workers/noxlink-brain/src/actors.ts.

export const DEFAULT_ACTOR_TONE =
  `First-person, written like a Bluesky post — short, public, a touch of personality. ` +
  `One sentence, two max. Specific over generic: name the feature, file, or bug; ` +
  `not "improvements" or "refactor work." No preambles like "Quick follow-up on…" ` +
  `or "Just shipped…". No hype words ("amazing," "excited," "awesome," "exciting") ` +
  `and no emoji. Conversational, slightly dry, with room for a small observation or ` +
  `aside when the change is mundane. Speak to readers, not coworkers — no "we just," ` +
  `no "the team."`;

export async function resolveActorFromGithub(db, ownerId, author) {
  if (!author?.login || author.id == null) return null;
  const login = author.login.toLowerCase();
  const githubUserId = String(author.id);
  const newId = `actor_${login}`;
  const kind = author.type === "Bot" ? "bot" : "human";

  const existing = await db.prepare(
    "SELECT id FROM actors WHERE owner_id = ? AND github_user_id = ?"
  ).bind(ownerId, githubUserId).first();

  if (existing) {
    // Backfill avatar if missing; only update name when it still matches
    // the auto-generated default (login). Never clobber user edits.
    await db.prepare(
      `UPDATE actors
         SET avatar_url = COALESCE(avatar_url, ?),
             name = CASE
               WHEN name = ? THEN COALESCE(?, name)
               ELSE name
             END,
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ? AND owner_id = ?`
    ).bind(
      author.avatar_url ?? null,
      login,
      author.name ?? null,
      existing.id,
      ownerId,
    ).run();

    return await db.prepare(
      "SELECT id, name, tone FROM actors WHERE id = ? AND owner_id = ?"
    ).bind(existing.id, ownerId).first();
  }

  // ON CONFLICT(id) — two webhooks racing for the same person produce the
  // same deterministic id, so the second insert is a no-op.
  await db.prepare(
    `INSERT INTO actors (id, github_user_id, name, avatar_url, tone, kind, owner_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
     ON CONFLICT(id) DO NOTHING`
  ).bind(
    newId,
    githubUserId,
    author.name || author.login,
    author.avatar_url ?? null,
    DEFAULT_ACTOR_TONE,
    kind,
    ownerId,
  ).run();

  return await db.prepare(
    "SELECT id, name, tone FROM actors WHERE owner_id = ? AND github_user_id = ?"
  ).bind(ownerId, githubUserId).first();
}
