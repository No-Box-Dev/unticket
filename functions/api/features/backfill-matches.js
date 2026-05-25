// POST /api/features/backfill-matches  body: { days?: 1..30 (default 14), force?: boolean }
//
// Walks every active repo, pulls PRs updated in the last N days from GitHub,
// filters to those without any pr_feature_links row, and runs the LLM matcher
// on each one. Uses the full GitHub PR payload (title + body + branch) so the
// LLM has the same signal it would see from a live webhook.
//
// Idempotency: the matcher's own pr_match_attempts cache already dedupes
// within a 168h TTL. `force=true` deletes those attempt rows for the
// candidate window so the matcher will re-ask after features have been
// added since the last sweep.

import { getCtx, jsonResponse, errorResponse } from "../../lib/db";
import { getInactiveRepoSet } from "../../lib/inactive-repos";
import { matchPRToFeatures } from "../../lib/feature-matcher";
import { getInstallationIdForOrg, getInstallationToken } from "../../lib/github-app";

const DEFAULT_DAYS = 14;
const MAX_DAYS = 30;
const MAX_PRS_PER_RUN = 50;

export async function onRequestPost(context) {
  const { orgId, orgLogin, isAdmin } = getCtx(context);
  if (!orgId || !orgLogin) return errorResponse("Missing org context", 400);
  if (!isAdmin) return errorResponse("Admin required", 403);
  if (!context.env.ZHIPU_API_KEY) {
    return errorResponse("LLM matcher disabled (ZHIPU_API_KEY not configured)", 503);
  }

  const installationId = await getInstallationIdForOrg(context.env.DB, orgId);
  if (!installationId) return errorResponse("GitHub App not installed for this org", 412);

  let token;
  try {
    token = await getInstallationToken(context.env, installationId);
  } catch (err) {
    console.error("[backfill-matches] install token fetch failed", { msg: err?.message });
    return errorResponse("Failed to acquire GitHub App token", 500);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    body = {};
  }
  const days = Math.max(1, Math.min(MAX_DAYS, Number(body?.days) || DEFAULT_DAYS));
  const force = Boolean(body?.force);

  const db = context.env.DB;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

  const repoRows = await db
    .prepare("SELECT name FROM repos WHERE org_id = ?")
    .bind(orgId)
    .all();
  const allRepoNames = (repoRows.results ?? []).map((r) => r.name);
  const inactive = await getInactiveRepoSet(db, orgId, orgLogin);
  const activeRepos = allRepoNames.filter((name) => !inactive.has(name));

  const candidates = [];
  let prsSeen = 0;
  let prsLinked = 0;
  const errors = [];
  for (const repo of activeRepos) {
    let prs;
    try {
      prs = await fetchPRsUpdatedSince(token, orgLogin, repo, cutoff);
    } catch (err) {
      const msg = err?.message ?? String(err);
      console.error(`[unticket backfill-matches] fetch ${repo} failed:`, msg);
      errors.push(`${repo}: ${msg}`);
      continue;
    }
    if (prs.length === 0) continue;
    prsSeen += prs.length;

    const numbers = prs.map((p) => p.number);
    const linked = await fetchLinkedNumbers(db, orgId, repo, numbers);
    prsLinked += linked.size;

    for (const pr of prs) {
      if (linked.has(pr.number)) continue;
      candidates.push({ repo, pr });
      if (candidates.length >= MAX_PRS_PER_RUN) break;
    }
    if (candidates.length >= MAX_PRS_PER_RUN) break;
  }

  if (candidates.length === 0) {
    return jsonResponse({
      ok: true,
      scanned: 0,
      queued: 0,
      repos: activeRepos.length,
      reposInTable: allRepoNames.length,
      prsSeen,
      prsLinked,
      errors,
      days,
      force,
    });
  }

  if (force) {
    const stmt = db.prepare(
      "DELETE FROM pr_match_attempts WHERE org_id = ? AND pr_repo = ? AND pr_number = ?",
    );
    const ops = candidates.map(({ repo, pr }) => stmt.bind(orgId, repo, pr.number));
    for (let i = 0; i < ops.length; i += 50) {
      await db.batch(ops.slice(i, i + 50));
    }
  }

  context.waitUntil(
    (async () => {
      for (const { repo, pr } of candidates) {
        try {
          await matchPRToFeatures(context.env, orgId, repo, pr);
        } catch (err) {
          console.error(
            `[unticket backfill-matches] ${repo}#${pr.number} failed:`,
            err?.message ?? err,
          );
        }
      }
    })(),
  );

  return jsonResponse({
    ok: true,
    scanned: candidates.length,
    queued: candidates.length,
    repos: activeRepos.length,
    reposInTable: allRepoNames.length,
    prsSeen,
    prsLinked,
    errors,
    capped: candidates.length >= MAX_PRS_PER_RUN,
    days,
    force,
  });
}

// We page on `sort=updated&direction=desc` (the only useful descending order
// GitHub gives us — `sort=created` is supported but not for `state=all`), but
// keep ONLY PRs created or merged inside the window. A 73-day-old PR with a
// recent comment has a fresh updated_at; we don't want to re-match those.
async function fetchPRsUpdatedSince(token, orgLogin, repo, cutoffIso) {
  const url = `https://api.github.com/repos/${encodeURIComponent(orgLogin)}/${encodeURIComponent(repo)}/pulls?state=all&sort=updated&direction=desc&per_page=100`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Unticket",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub ${res.status} ${res.statusText} for ${repo}`);
  }
  const all = await res.json();
  const cutoffMs = new Date(cutoffIso).getTime();
  return all.filter((pr) => {
    const createdMs = new Date(pr.created_at).getTime();
    if (Number.isFinite(createdMs) && createdMs >= cutoffMs) return true;
    if (pr.merged_at) {
      const mergedMs = new Date(pr.merged_at).getTime();
      if (Number.isFinite(mergedMs) && mergedMs >= cutoffMs) return true;
    }
    return false;
  });
}

async function fetchLinkedNumbers(db, orgId, repo, numbers) {
  if (numbers.length === 0) return new Set();
  const placeholders = numbers.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT pr_number FROM pr_feature_links
        WHERE org_id = ? AND pr_repo = ? AND pr_number IN (${placeholders})`,
    )
    .bind(orgId, repo, ...numbers)
    .all();
  return new Set((rows.results ?? []).map((r) => r.pr_number));
}
