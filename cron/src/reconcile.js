// reconcileOrg — pull GitHub state into D1 for one org per cron tick.
//
// Webhooks already write to D1 in real time, so this is the safety net
// for everything webhooks structurally can't deliver: deletes (GitHub
// doesn't fire `repository.deleted` reliably for transferred repos,
// and member removal events can drop), missed deliveries during
// deploys, and label changes on issues created before the App was
// installed (those issues never get an `issues.labeled` event for
// pre-existing labels).
//
// This module imports the same sync helpers the Pages app uses.
// Wrangler bundles them via the relative path; no code is duplicated.

import {
  syncRepos,
  syncMembers,
  syncTeams,
  syncFeatures,
  syncPRs,
  syncIssues,
  removeRepo,
  removeMember,
} from "../../functions/lib/github-sync.js";
import { getInstallationToken } from "../../functions/lib/github-app.js";
import { getInactiveRepoSet } from "../../functions/lib/inactive-repos.js";
import { recordMergedPr } from "../../functions/lib/events.js";

// Look back this far when hunting for missed PR-merge narratives. Long
// enough to cover a deploy gap or a 24h Zhipu outage; short enough that
// we don't backfill ancient history every tick.
const MISSED_MERGE_LOOKBACK_HOURS = 48;

// If an unfinished run started within this window, the cron skips the org
// to avoid two ticks racing. Picked just under the 30 min cron interval.
const LOCK_WINDOW_MIN = 25;

// An installation is flagged 'silent' if no webhook event arrived within
// this window AND reconcile saw nothing new on this tick.
const SILENT_THRESHOLD_HOURS = 24;

export async function reconcileOrg(env, db, orgId, orgLogin, installationId) {
  const lock = await acquireLock(db, orgId);
  if (!lock) {
    console.log(`[unticket-cron] org=${orgLogin} skipped: prior run still in flight`);
    return;
  }

  const startedAtMs = Date.now();

  try {
    const token = await getInstallationToken(env, installationId);

    // Members + features + repos: full reconcile (small N) detects deletes.
    const [apiMembers, apiRepos] = await Promise.all([
      syncMembers(db, token, orgId, orgLogin),
      syncRepos(db, token, orgId, orgLogin),
    ]);
    await reconcileDeletedMembers(db, orgId, apiMembers);
    await reconcileDeletedRepos(db, orgId, apiRepos);
    await syncTeams(db, token, orgId, orgLogin);
    await syncFeatures(db, token, orgId, orgLogin);

    // Issues + PRs per active repo with incremental `since` cursor.
    const inactive = await getInactiveRepoSet(db, orgId, orgLogin);
    const activeRepos = apiRepos.filter((name) => !inactive.has(name));
    for (const repo of activeRepos) {
      try {
        await syncPRs(db, token, orgId, orgLogin, repo, await sinceCursor(db, orgId, `prs:${repo}`));
      } catch (err) {
        console.error(`[unticket-cron] org=${orgLogin} repo=${repo} PRs failed:`, err?.message ?? err);
      }
      try {
        await syncIssues(db, token, orgId, orgLogin, repo, await sinceCursor(db, orgId, `issues:${repo}`));
      } catch (err) {
        console.error(`[unticket-cron] org=${orgLogin} repo=${repo} issues failed:`, err?.message ?? err);
      }
      try {
        await narrateMissedMerges(env, db, orgId, orgLogin, repo);
      } catch (err) {
        console.error(`[unticket-cron] org=${orgLogin} repo=${repo} missed-merge narration failed:`, err?.message ?? err);
      }
    }

    await updateHealthStatus(db, orgId, installationId);

    await db
      .prepare(
        `UPDATE reconcile_runs
           SET finished_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), duration_ms = ?
         WHERE id = ?`,
      )
      .bind(Date.now() - startedAtMs, lock)
      .run();
  } catch (err) {
    await db
      .prepare(
        `UPDATE reconcile_runs
           SET finished_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), duration_ms = ?, error = ?
         WHERE id = ?`,
      )
      .bind(Date.now() - startedAtMs, String(err?.message ?? err).slice(0, 500), lock)
      .run();
    throw err;
  }
}

// Insert a reconcile_runs row with finished_at = NULL. Returns the row id
// (the lock token). Returns null if a prior unfinished run started within
// the last LOCK_WINDOW_MIN minutes — caller should skip the tick.
async function acquireLock(db, orgId) {
  const recent = await db
    .prepare(
      `SELECT id FROM reconcile_runs
        WHERE org_id = ?
          AND finished_at IS NULL
          AND started_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)
        LIMIT 1`,
    )
    .bind(orgId, `-${LOCK_WINDOW_MIN} minutes`)
    .first();
  if (recent) return null;

  const inserted = await db
    .prepare(
      `INSERT INTO reconcile_runs (org_id, started_at)
       VALUES (?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
       RETURNING id`,
    )
    .bind(orgId)
    .first();
  return inserted?.id ?? null;
}

async function sinceCursor(db, orgId, resource) {
  const row = await db
    .prepare("SELECT last_synced FROM sync_state WHERE org_id = ? AND resource = ?")
    .bind(orgId, resource)
    .first();
  return row?.last_synced ?? null;
}

// Find PRs merged in the lookback window that don't yet have a
// github:pr:merged event row, and write+narrate one each. Catches the
// case where the pull_request webhook was missed (deploy, GitHub
// delivery pause) — the canonical sync now has the merge, but Posts
// would never have seen it.
//
// `pull_requests` only stores author login + avatar; we join gh_users
// to get the GitHub user_id needed for actor resolution. PRs whose
// author isn't in gh_users yet (e.g. an external contributor on an
// unsynced repo) are skipped this tick and picked up after the next
// syncPRs upserts gh_users.
async function narrateMissedMerges(env, db, orgId, orgLogin, repo) {
  const projectId = `proj_${orgLogin}_${repo}`.toLowerCase();

  const rows = await db
    .prepare(
      `SELECT pr.number, pr.title, pr.author, pr.author_avatar, pr.merged_at,
              u.id AS user_id, u.type AS user_type
         FROM pull_requests pr
         LEFT JOIN gh_users u ON u.login = pr.author
        WHERE pr.org_id = ? AND pr.repo = ?
          AND pr.merged_at IS NOT NULL
          AND pr.merged_at > datetime('now', ?)
          AND NOT EXISTS (
            SELECT 1 FROM events e
            WHERE e.owner_id = ? AND e.repo = ?
              AND e.type = 'github:pr:merged'
              AND CAST(json_extract(e.payload_json, '$.pr.number') AS INTEGER) = pr.number
          )`,
    )
    .bind(orgId, repo, `-${MISSED_MERGE_LOOKBACK_HOURS} hours`, orgLogin, repo)
    .all();

  for (const row of rows.results ?? []) {
    if (!row.author || row.user_id == null) continue;
    try {
      await recordMergedPr(env, {
        ownerId: orgLogin,
        projectId,
        org: orgLogin,
        repo,
        deliveryId: `reconcile:${orgLogin}:${repo}:pr-${row.number}:merged`,
        source: "github-reconcile",
        pr: {
          number: row.number,
          title: row.title,
          state: "closed",
          merged_at: row.merged_at,
          user: {
            login: row.author,
            id: Number(row.user_id),
            avatar_url: row.author_avatar,
            type: row.user_type === "Bot" ? "Bot" : "User",
          },
        },
      });
    } catch (err) {
      console.error(`[unticket-cron] recordMergedPr ${repo}#${row.number} failed:`, err?.message ?? err);
    }
  }
}

async function reconcileDeletedMembers(db, orgId, apiMemberLogins) {
  const apiSet = new Set(apiMemberLogins);
  const existing = await db
    .prepare("SELECT login FROM members WHERE org_id = ?")
    .bind(orgId)
    .all();
  for (const row of existing.results ?? []) {
    if (!apiSet.has(row.login)) {
      await removeMember(db, orgId, row.login);
    }
  }
}

async function reconcileDeletedRepos(db, orgId, apiRepoNames) {
  const apiSet = new Set(apiRepoNames);
  const existing = await db
    .prepare("SELECT name FROM repos WHERE org_id = ?")
    .bind(orgId)
    .all();
  for (const row of existing.results ?? []) {
    if (!apiSet.has(row.name)) {
      await removeRepo(db, orgId, row.name);
    }
  }
}

async function updateHealthStatus(db, orgId, installationId) {
  if (!installationId) return;
  const row = await db
    .prepare("SELECT last_event_at FROM orgs WHERE id = ?")
    .bind(orgId)
    .first();
  const lastEventAt = row?.last_event_at;

  let status = null;
  if (!lastEventAt) {
    status = "silent";
  } else {
    const ageMs = Date.now() - new Date(lastEventAt).getTime();
    if (ageMs > SILENT_THRESHOLD_HOURS * 60 * 60 * 1000) status = "silent";
  }

  await db
    .prepare("UPDATE installations SET health_status = ? WHERE installation_id = ?")
    .bind(status, installationId)
    .run();
}
