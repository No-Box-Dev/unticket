import { getCtx, jsonResponse, errorResponse } from "../lib/db";
import { syncRepo } from "../lib/github-sync";

// Admin-only, cursor-batched recovery for repositories that are no longer
// available to the GitHub App installation token. This route deliberately uses
// the authenticated admin's user token: it may still see archived or
// transferred repositories that the installation can no longer access.
export async function onRequestPost(context) {
  const { orgId, orgLogin, token, isAdmin } = getCtx(context);
  if (!isAdmin) return errorResponse("Admin required", 403);

  const url = new URL(context.request.url);
  const cursor = url.searchParams.get("cursor");
  if (!cursor) {
    const rows = await context.env.DB
      .prepare(
        `SELECT DISTINCT project.repo
         FROM projects project
         WHERE project.owner_id = ? AND project.repo IS NOT NULL
           AND (
             project.archived = 1
             OR NOT EXISTS (
               SELECT 1 FROM repos repo
               WHERE repo.org_id = ? AND repo.name = project.repo
             )
           )
         ORDER BY project.repo`,
      )
      .bind(orgLogin, orgId)
      .all();
    const repoList = (rows.results ?? []).map((row) => row.repo).filter(Boolean);
    return jsonResponse({
      done: repoList.length === 0,
      cursor: repoList[0] ?? null,
      repoList,
      repos: repoList.length,
    });
  }

  const project = await context.env.DB
    .prepare(
      `SELECT repo, archived, archived_at
       FROM projects
       WHERE owner_id = ? AND repo = ?
       LIMIT 1`,
    )
    .bind(orgLogin, cursor)
    .first();
  if (!project) return errorResponse("Unknown repository", 404);

  const repoResponse = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(orgLogin)}/${encodeURIComponent(cursor)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Unticket",
      },
    },
  );
  if (repoResponse.status === 404 || repoResponse.status === 403) {
    return jsonResponse({ done: true, repo: cursor, recovered: false, inaccessible: true });
  }
  if (!repoResponse.ok) {
    return errorResponse(`GitHub repository lookup failed (${repoResponse.status})`, 502);
  }

  const githubRepo = await repoResponse.json();
  const currentOwner = githubRepo.owner?.login ?? orgLogin;
  const transferred = currentOwner.toLowerCase() !== orgLogin.toLowerCase();
  const stamp = new Date().toISOString();

  await context.env.DB
    .prepare(
      `INSERT INTO repos
         (org_id, name, language, pushed_at, discovered_at, retired_at, retirement_reason, transferred_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id, name) DO UPDATE SET
         language = excluded.language,
         pushed_at = excluded.pushed_at,
         retired_at = CASE WHEN excluded.transferred_to IS NOT NULL THEN excluded.retired_at ELSE repos.retired_at END,
         retirement_reason = CASE WHEN excluded.transferred_to IS NOT NULL THEN 'transferred' ELSE repos.retirement_reason END,
         transferred_to = COALESCE(excluded.transferred_to, repos.transferred_to)`,
    )
    .bind(
      orgId,
      cursor,
      githubRepo.language ?? null,
      githubRepo.pushed_at ?? null,
      stamp,
      transferred ? stamp : null,
      transferred ? "transferred" : null,
      transferred ? currentOwner : null,
    )
    .run();

  // GitHub follows old-repository redirects, so the original org/name path
  // can still recover a transferred repository while preserving its historic
  // identity in Unticket.
  await syncRepo(context.env.DB, token, orgId, orgLogin, cursor, true, context.env);

  const earliest = await context.env.DB
    .prepare(
      `SELECT MIN(created_at) AS first_seen FROM (
         SELECT created_at FROM pull_requests WHERE org_id = ? AND repo = ?
         UNION ALL
         SELECT created_at FROM issues WHERE org_id = ? AND repo = ?
       )`,
    )
    .bind(orgId, cursor, orgId, cursor)
    .first();

  if (earliest?.first_seen) {
    const trackedUntil = project.archived_at ?? (transferred ? stamp : null);
    await context.env.DB
      .prepare(
        `INSERT INTO repo_tracking_periods
           (org_id, repo, tracked_from, tracked_until, ended_reason)
         SELECT ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM repo_tracking_periods
           WHERE org_id = ? AND repo = ?
         )`,
      )
      .bind(
        orgId,
        cursor,
        earliest.first_seen,
        trackedUntil,
        project.archived ? "platform_archived" : transferred ? "transferred" : null,
        orgId,
        cursor,
      )
      .run();
  }

  return jsonResponse({
    done: true,
    repo: cursor,
    recovered: true,
    transferredTo: transferred ? currentOwner : null,
  });
}
