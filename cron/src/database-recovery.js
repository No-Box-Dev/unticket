import { getInstallationToken } from "../../functions/lib/github-app.js";
import { syncRepo } from "../../functions/lib/github-sync.js";

const GITHUB_HEADERS = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "Unticket",
});

async function fetchInstallationRepos(token) {
  const repos = [];
  for (let page = 1; page <= 50; page += 1) {
    const response = await fetch(
      `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
      { headers: GITHUB_HEADERS(token) },
    );
    if (!response.ok) {
      const reset = response.headers.get("X-RateLimit-Reset");
      const resetText = reset ? `; resets ${new Date(Number(reset) * 1000).toISOString()}` : "";
      throw new Error(`installation repositories failed (${response.status}${resetText})`);
    }
    const body = await response.json();
    const pageRepos = Array.isArray(body.repositories) ? body.repositories : [];
    repos.push(...pageRepos);
    if (pageRepos.length < 100) break;
  }
  return repos;
}

async function initializeRequest(env, request) {
  const installations = await env.DB
    .prepare(
      `SELECT installation.installation_id, installation.account_login,
              installation.account_type, org.id AS org_id
       FROM installations installation
       JOIN orgs org ON org.installation_id = installation.installation_id
       ORDER BY CASE installation.account_type WHEN 'Organization' THEN 0 ELSE 1 END,
                installation.account_login`,
    )
    .all();
  const orgRows = await env.DB.prepare("SELECT id, github_login FROM orgs").all();
  const orgByLogin = new Map(
    (orgRows.results ?? []).map((row) => [String(row.github_login).toLowerCase(), Number(row.id)]),
  );

  // Prefer an organization installation when the same repository is also
  // visible through a personal installation.
  const repositories = new Map();
  for (const installation of installations.results ?? []) {
    const token = await getInstallationToken(env, installation.installation_id);
    const visible = await fetchInstallationRepos(token);
    for (const repo of visible) {
      const ownerLogin = repo.owner?.login;
      if (!ownerLogin || !repo.name) continue;
      const targetOrgId = orgByLogin.get(String(ownerLogin).toLowerCase()) ?? Number(installation.org_id);
      const key = `${targetOrgId}:${String(ownerLogin).toLowerCase()}/${String(repo.name).toLowerCase()}`;
      if (!repositories.has(key)) {
        repositories.set(key, {
          installationId: Number(installation.installation_id),
          orgId: targetOrgId,
          ownerLogin: String(ownerLogin),
          repo: String(repo.name),
          language: repo.language ?? null,
          pushedAt: repo.pushed_at ?? null,
          archived: repo.archived === true,
        });
      }
    }
  }

  for (const item of repositories.values()) {
    await env.DB.batch([
      env.DB
        .prepare(
          `INSERT INTO repos (org_id, name, language, pushed_at, archived_at, discovered_at)
           VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
           ON CONFLICT(org_id, name) DO UPDATE SET
             language = excluded.language,
             pushed_at = excluded.pushed_at,
             archived_at = CASE
               WHEN excluded.archived_at IS NOT NULL THEN COALESCE(repos.archived_at, excluded.archived_at)
               ELSE repos.archived_at
             END`,
        )
        .bind(
          item.orgId,
          item.repo,
          item.language,
          item.pushedAt,
          item.archived ? new Date().toISOString() : null,
        ),
      env.DB
        .prepare(
          `INSERT OR IGNORE INTO database_recovery_repos
             (request_id, installation_id, org_id, owner_login, repo)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(request.id, item.installationId, item.orgId, item.ownerLogin, item.repo),
    ]);
  }

  await env.DB
    .prepare(
      `UPDATE database_recovery_requests
       SET status = 'running',
           started_at = COALESCE(started_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
           repos_total = (SELECT COUNT(*) FROM database_recovery_repos WHERE request_id = ?),
           error = NULL
       WHERE id = ?`,
    )
    .bind(request.id, request.id)
    .run();
}

async function counts(db, orgId, repo) {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM pull_requests WHERE org_id = ? AND repo = ?) AS prs,
         (SELECT COUNT(*) FROM issues WHERE org_id = ? AND repo = ?) AS issues`,
    )
    .bind(orgId, repo, orgId, repo)
    .first();
  return { prs: Number(row?.prs ?? 0), issues: Number(row?.issues ?? 0) };
}

async function finishIfDrained(db, requestId) {
  const row = await db
    .prepare(
      `SELECT
         SUM(status = 'done') AS done,
         SUM(status = 'failed') AS failed,
         SUM(status IN ('pending', 'running')) AS remaining
       FROM database_recovery_repos WHERE request_id = ?`,
    )
    .bind(requestId)
    .first();
  const remaining = Number(row?.remaining ?? 0);
  await db
    .prepare(
      `UPDATE database_recovery_requests
       SET repos_done = ?, repos_failed = ?,
           status = CASE WHEN ? = 0 THEN 'completed' ELSE status END,
           completed_at = CASE WHEN ? = 0 THEN strftime('%Y-%m-%dT%H:%M:%SZ', 'now') ELSE completed_at END
       WHERE id = ?`,
    )
    .bind(Number(row?.done ?? 0), Number(row?.failed ?? 0), remaining, remaining, requestId)
    .run();
  return remaining === 0;
}

export async function runDatabaseRecoveryStep(env) {
  let request = await env.DB
    .prepare(
      `SELECT * FROM database_recovery_requests
       WHERE status IN ('pending', 'running')
       ORDER BY id LIMIT 1`,
    )
    .first();
  if (!request) return { done: true, idle: true };

  if (request.status === "pending") {
    try {
      await initializeRequest(env, request);
    } catch (error) {
      await env.DB
        .prepare(
          `UPDATE database_recovery_requests
           SET status = 'failed', completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), error = ?
           WHERE id = ?`,
        )
        .bind(String(error?.message ?? error).slice(0, 500), request.id)
        .run();
      throw error;
    }
    request = { ...request, status: "running" };
  }

  const job = await env.DB
    .prepare(
      `SELECT * FROM database_recovery_repos
       WHERE request_id = ? AND status = 'pending'
       ORDER BY owner_login, repo LIMIT 1`,
    )
    .bind(request.id)
    .first();
  if (!job) {
    await finishIfDrained(env.DB, request.id);
    return { done: true, requestId: request.id };
  }

  await env.DB
    .prepare(
      `UPDATE database_recovery_repos
       SET status = 'running', attempts = attempts + 1,
           started_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), error = NULL
       WHERE request_id = ? AND installation_id = ? AND owner_login = ? AND repo = ? AND status = 'pending'`,
    )
    .bind(request.id, job.installation_id, job.owner_login, job.repo)
    .run();

  const before = await counts(env.DB, job.org_id, job.repo);
  try {
    const token = await getInstallationToken(env, job.installation_id);
    await syncRepo(env.DB, token, job.org_id, job.owner_login, job.repo, true, env);
    const after = await counts(env.DB, job.org_id, job.repo);
    await env.DB
      .prepare(
        `UPDATE database_recovery_repos
         SET status = 'done', completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
             prs_before = ?, prs_after = ?, issues_before = ?, issues_after = ?, error = NULL
         WHERE request_id = ? AND installation_id = ? AND owner_login = ? AND repo = ?`,
      )
      .bind(
        before.prs, after.prs, before.issues, after.issues,
        request.id, job.installation_id, job.owner_login, job.repo,
      )
      .run();
    const done = await finishIfDrained(env.DB, request.id);
    return { done, requestId: request.id, repo: `${job.owner_login}/${job.repo}`, before, after };
  } catch (error) {
    await env.DB
      .prepare(
        `UPDATE database_recovery_repos
         SET status = 'failed', completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
             prs_before = ?, issues_before = ?, error = ?
         WHERE request_id = ? AND installation_id = ? AND owner_login = ? AND repo = ?`,
      )
      .bind(
        before.prs, before.issues, String(error?.message ?? error).slice(0, 500),
        request.id, job.installation_id, job.owner_login, job.repo,
      )
      .run();
    await finishIfDrained(env.DB, request.id);
    throw error;
  }
}

export const databaseRecoveryInternals = { fetchInstallationRepos };
