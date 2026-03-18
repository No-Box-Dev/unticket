import { getSyncState, setSyncState } from "./db";
import { parseFeatureMetadata, parseFeatureFromBranch } from "./feature-metadata";

// Paginated GitHub API fetcher
async function fetchAllPages(token, url, params = {}) {
  const all = [];
  let page = 1;

  while (true) {
    const searchParams = new URLSearchParams({
      ...params,
      per_page: "100",
      page: String(page),
    });

    const res = await fetch(`${url}?${searchParams}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "GitPulse",
        Accept: "application/vnd.github+json",
      },
    });

    if (!res.ok) {
      if (res.status === 401) {
        throw new Error("GitHub token expired or revoked");
      }
      if (res.status === 403 || res.status === 429) {
        const remaining = res.headers.get("X-RateLimit-Remaining");
        if (remaining === "0" || res.status === 429) {
          const resetEpoch = res.headers.get("X-RateLimit-Reset");
          const resetInfo = resetEpoch
            ? ` Resets at ${new Date(Number(resetEpoch) * 1000).toISOString()}`
            : "";
          throw new Error(`GitHub API rate limit exceeded.${resetInfo}`);
        }
        // Other 403 (permissions etc.) — skip gracefully
        break;
      }
      if (res.status === 404) break;
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    all.push(...data);

    if (data.length < 100) break;
    page++;
  }

  return all;
}

// ---------- Sync repos ----------

export async function syncRepos(db, token, orgId, orgLogin) {
  const repos = await fetchAllPages(
    token,
    `https://api.github.com/orgs/${orgLogin}/repos`,
    { sort: "pushed" }
  );

  const stmt = db.prepare(
    `INSERT INTO repos (org_id, name, language, pushed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(org_id, name) DO UPDATE SET
       language = excluded.language,
       pushed_at = excluded.pushed_at`
  );

  for (let i = 0; i < repos.length; i += 50) {
    const batch = repos.slice(i, i + 50);
    await db.batch(
      batch.map((r) => stmt.bind(orgId, r.name, r.language, r.pushed_at))
    );
  }

  await setSyncState(db, orgId, "repos");
}

// ---------- Sync PRs ----------

export async function syncPRs(db, token, orgId, orgLogin, repo, since) {
  const params = {
    state: "all",
    sort: "updated",
    direction: "desc",
  };
  if (since) params.since = since;

  const prs = await fetchAllPages(
    token,
    `https://api.github.com/repos/${orgLogin}/${repo}/pulls`,
    params
  );

  const stmt = db.prepare(
    `INSERT INTO pull_requests (org_id, repo, number, title, state, author, author_avatar, draft, head_ref, base_ref, merged_at, created_at, updated_at, html_url, requested_reviewers_json, labels_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id, repo, number) DO UPDATE SET
       title = excluded.title,
       state = excluded.state,
       author = excluded.author,
       author_avatar = excluded.author_avatar,
       draft = excluded.draft,
       head_ref = excluded.head_ref,
       base_ref = excluded.base_ref,
       merged_at = excluded.merged_at,
       updated_at = excluded.updated_at,
       html_url = excluded.html_url,
       requested_reviewers_json = excluded.requested_reviewers_json,
       labels_json = excluded.labels_json`
  );

  for (let i = 0; i < prs.length; i += 50) {
    const batch = prs.slice(i, i + 50);
    await db.batch(
      batch.map((pr) =>
        stmt.bind(
          orgId,
          repo,
          pr.number,
          pr.title,
          pr.merged_at ? "merged" : pr.state,
          pr.user?.login ?? null,
          pr.user?.avatar_url ?? null,
          pr.draft ? 1 : 0,
          pr.head?.ref ?? null,
          pr.base?.ref ?? null,
          pr.merged_at,
          pr.created_at,
          pr.updated_at,
          pr.html_url,
          JSON.stringify(pr.requested_reviewers?.map((r) => ({ login: r.login })) ?? []),
          JSON.stringify(pr.labels?.map((l) => ({ name: l.name, color: l.color })) ?? [])
        )
      )
    );
  }

  // Auto-detect feature links from branch names
  const branchLinkStmt = db.prepare(
    `INSERT INTO pr_feature_links (org_id, feature_number, pr_repo, pr_number, source)
     VALUES (?, ?, ?, ?, 'branch')
     ON CONFLICT(org_id, feature_number, pr_repo, pr_number) DO NOTHING`
  );
  const branchLinks = prs
    .map((pr) => ({ featureNumber: parseFeatureFromBranch(pr.head?.ref), pr }))
    .filter((x) => x.featureNumber !== null);
  for (let i = 0; i < branchLinks.length; i += 50) {
    const batch = branchLinks.slice(i, i + 50);
    await db.batch(
      batch.map((x) => branchLinkStmt.bind(orgId, x.featureNumber, repo, x.pr.number))
    );
  }

  // Only advance sync timestamp if we got data or this is a fresh sync
  if (prs.length > 0 || !since) {
    await setSyncState(db, orgId, `prs:${repo}`);
  }
}

// ---------- Sync Issues ----------

export async function syncIssues(db, token, orgId, orgLogin, repo, since) {
  const params = {
    state: "all",
    sort: "updated",
    direction: "desc",
  };
  if (since) params.since = since;

  const allItems = await fetchAllPages(
    token,
    `https://api.github.com/repos/${orgLogin}/${repo}/issues`,
    params
  );

  const issues = allItems.filter((i) => !i.pull_request);

  // Fetch closed_by for closed issues via events API (batched to avoid N+1)
  const closedByMap = new Map();
  const closedIssues = issues.filter((i) => i.state === "closed");
  const BATCH_SIZE = 10;
  for (let i = 0; i < closedIssues.length; i += BATCH_SIZE) {
    const batch = closedIssues.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (issue) => {
        const eventsRes = await fetch(
          `https://api.github.com/repos/${orgLogin}/${repo}/issues/${issue.number}/events?per_page=100`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "User-Agent": "GitPulse",
              Accept: "application/vnd.github+json",
            },
          }
        );
        if (!eventsRes.ok) return { number: issue.number, login: null };
        const events = await eventsRes.json();
        const closedEvent = events.filter((e) => e.event === "closed").pop();
        return { number: issue.number, login: closedEvent?.actor?.login ?? null };
      })
    );
    for (const result of results) {
      if (result.status === "fulfilled" && result.value.login) {
        closedByMap.set(result.value.number, result.value.login);
      }
    }
  }

  const stmt = db.prepare(
    `INSERT INTO issues (org_id, repo, number, title, state, author, author_avatar, created_at, updated_at, closed_at, html_url, assignees_json, labels_json, milestone_title, closed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id, repo, number) DO UPDATE SET
       title = excluded.title,
       state = excluded.state,
       author = excluded.author,
       author_avatar = excluded.author_avatar,
       updated_at = excluded.updated_at,
       closed_at = excluded.closed_at,
       html_url = excluded.html_url,
       assignees_json = excluded.assignees_json,
       labels_json = excluded.labels_json,
       milestone_title = excluded.milestone_title,
       closed_by = COALESCE(excluded.closed_by, issues.closed_by)`
  );

  for (let i = 0; i < issues.length; i += 50) {
    const batch = issues.slice(i, i + 50);
    await db.batch(
      batch.map((issue) =>
        stmt.bind(
          orgId,
          repo,
          issue.number,
          issue.title,
          issue.state,
          issue.user?.login ?? null,
          issue.user?.avatar_url ?? null,
          issue.created_at,
          issue.updated_at,
          issue.closed_at,
          issue.html_url,
          JSON.stringify(issue.assignees.map((a) => ({ login: a.login, avatar_url: a.avatar_url }))),
          JSON.stringify(issue.labels.map((l) => ({ name: l.name, color: l.color }))),
          issue.milestone?.title ?? null,
          closedByMap.get(issue.number) ?? null
        )
      )
    );
  }

  // Only advance sync timestamp if we got data or this is a fresh sync
  if (issues.length > 0 || !since) {
    await setSyncState(db, orgId, `issues:${repo}`);
  }
}

// ---------- Sync Members ----------

export async function syncMembers(db, token, orgId, orgLogin) {
  const members = await fetchAllPages(
    token,
    `https://api.github.com/orgs/${orgLogin}/members`
  );

  const stmt = db.prepare(
    `INSERT INTO members (org_id, login, avatar_url)
     VALUES (?, ?, ?)
     ON CONFLICT(org_id, login) DO UPDATE SET
       avatar_url = excluded.avatar_url`
  );

  for (let i = 0; i < members.length; i += 50) {
    const batch = members.slice(i, i + 50);
    await db.batch(
      batch.map((m) => stmt.bind(orgId, m.login, m.avatar_url))
    );
  }

  await setSyncState(db, orgId, "members");
}

// ---------- Sync Features (.gitpulse repo issues) ----------

export async function syncFeatures(db, token, orgId, orgLogin) {
  const issues = await fetchAllPages(
    token,
    `https://api.github.com/repos/${orgLogin}/.gitpulse/issues`,
    { state: "all", sort: "updated", direction: "desc" }
  );

  // Every issue on the .gitpulse repo is a feature (filter out PRs only)
  const features = issues.filter((i) => !i.pull_request);

  console.log(`[unticket.ai] syncFeatures: ${issues.length} total issues, ${features.length} features (org=${orgLogin})`);

  if (features.length === 0 && issues.length > 0) {
    console.warn(`[unticket.ai] syncFeatures: ${issues.length} issues but 0 features — all PRs? (org=${orgLogin})`);
  }

  const stmt = db.prepare(
    `INSERT INTO features (org_id, number, title, state, body, assignees_json, labels_json, milestone_title, html_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id, number) DO UPDATE SET
       title = excluded.title,
       state = excluded.state,
       body = excluded.body,
       assignees_json = excluded.assignees_json,
       labels_json = excluded.labels_json,
       milestone_title = excluded.milestone_title,
       html_url = excluded.html_url,
       updated_at = excluded.updated_at`
  );

  for (let i = 0; i < features.length; i += 50) {
    const batch = features.slice(i, i + 50);
    await db.batch(
      batch.map((f) =>
        stmt.bind(
          orgId,
          f.number,
          f.title,
          f.state,
          f.body ?? "",
          JSON.stringify((f.assignees ?? []).map((a) => ({ login: a.login }))),
          JSON.stringify((f.labels ?? []).map((l) => ({ name: l.name, color: l.color }))),
          f.milestone?.title ?? null,
          f.html_url,
          f.created_at,
          f.updated_at
        )
      )
    );
  }

  // Extract linkedPRs from feature metadata and populate pr_feature_links
  const linkStmt = db.prepare(
    `INSERT INTO pr_feature_links (org_id, feature_number, pr_repo, pr_number, source)
     VALUES (?, ?, ?, ?, 'metadata')
     ON CONFLICT(org_id, feature_number, pr_repo, pr_number) DO NOTHING`
  );
  for (const f of features) {
    const { metadata } = parseFeatureMetadata(f.body ?? "");
    const linkedPRs = metadata.linkedPRs ?? [];
    if (linkedPRs.length > 0) {
      await db.batch(
        linkedPRs.map((l) => linkStmt.bind(orgId, f.number, l.repo, l.number))
      );
    }
  }

  await setSyncState(db, orgId, "features");
  return { synced: features.length, total: issues.length };
}

// ---------- Migrate .gitpulse config ----------

export async function migrateGitPulseConfig(db, token, orgId, orgLogin) {
  const existing = await db
    .prepare("SELECT COUNT(*) as count FROM config WHERE org_id = ?")
    .bind(orgId)
    .first();

  if (existing && existing.count > 0) return;

  const repoRes = await fetch(
    `https://api.github.com/repos/${orgLogin}/.gitpulse`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "GitPulse",
      },
    }
  );

  if (!repoRes.ok) return;

  const files = ["sprint", "features", "people", "settings"];

  for (const key of files) {
    const fileRes = await fetch(
      `https://api.github.com/repos/${orgLogin}/.gitpulse/contents/${key}.json`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "GitPulse",
          Accept: "application/vnd.github+json",
        },
      }
    );

    if (!fileRes.ok) continue;

    const fileData = await fileRes.json();
    if (!fileData.content) continue;

    const decoded = atob(fileData.content.replace(/\n/g, ""));

    await db
      .prepare(
        `INSERT INTO config (org_id, key, data, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(org_id, key) DO UPDATE SET
           data = excluded.data,
           updated_at = datetime('now')`
      )
      .bind(orgId, key, decoded)
      .run();
  }
}

// ---------- syncInit: lightweight init (repos + members + config migration) ----------

export async function syncInit(db, token, orgId, orgLogin) {
  await migrateGitPulseConfig(db, token, orgId, orgLogin);
  await syncRepos(db, token, orgId, orgLogin);
  await syncMembers(db, token, orgId, orgLogin);
  await syncFeatures(db, token, orgId, orgLogin);

  const repoRows = await db
    .prepare("SELECT name FROM repos WHERE org_id = ? ORDER BY name")
    .bind(orgId)
    .all();

  return repoRows.results.map((r) => r.name);
}

// ---------- syncRepo: sync PRs + issues for a single repo ----------

export async function syncRepo(db, token, orgId, orgLogin, repo, force = false) {
  try {
    const prSince = force ? null : (await getSyncState(db, orgId, `prs:${repo}`))?.lastSynced;
    await syncPRs(db, token, orgId, orgLogin, repo, prSince);
  } catch (err) {
    console.error(`[unticket.ai] syncRepo PRs failed for ${repo}:`, err?.message ?? err);
    throw err;
  }

  try {
    const issueSince = force ? null : (await getSyncState(db, orgId, `issues:${repo}`))?.lastSynced;
    await syncIssues(db, token, orgId, orgLogin, repo, issueSince);
  } catch (err) {
    console.error(`[unticket.ai] syncRepo issues failed for ${repo}:`, err?.message ?? err);
    throw err;
  }
}

// ---------- Upsert helpers for webhook events ----------

export async function upsertIssue(db, orgId, repo, issue, closedBy = null) {
  await db
    .prepare(
      `INSERT INTO issues (org_id, repo, number, title, state, author, author_avatar, created_at, updated_at, closed_at, html_url, assignees_json, labels_json, milestone_title, closed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id, repo, number) DO UPDATE SET
         title = excluded.title,
         state = excluded.state,
         author = excluded.author,
         author_avatar = excluded.author_avatar,
         updated_at = excluded.updated_at,
         closed_at = excluded.closed_at,
         html_url = excluded.html_url,
         assignees_json = excluded.assignees_json,
         labels_json = excluded.labels_json,
         milestone_title = excluded.milestone_title,
         closed_by = COALESCE(excluded.closed_by, issues.closed_by)`
    )
    .bind(
      orgId,
      repo,
      issue.number,
      issue.title,
      issue.state,
      issue.user?.login ?? null,
      issue.user?.avatar_url ?? null,
      issue.created_at,
      issue.updated_at,
      issue.closed_at ?? null,
      issue.html_url,
      JSON.stringify((issue.assignees ?? []).map((a) => ({ login: a.login, avatar_url: a.avatar_url }))),
      JSON.stringify((issue.labels ?? []).map((l) => ({ name: l.name, color: l.color }))),
      issue.milestone?.title ?? null,
      closedBy
    )
    .run();
}

export async function upsertFeature(db, orgId, issue) {

  // If the issue is closed and not a feature deletion, skip
  // (deleteFeature closes the issue)
  await db
    .prepare(
      `INSERT INTO features (org_id, number, title, state, body, assignees_json, labels_json, milestone_title, html_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id, number) DO UPDATE SET
         title = excluded.title,
         state = excluded.state,
         body = excluded.body,
         assignees_json = excluded.assignees_json,
         labels_json = excluded.labels_json,
         milestone_title = excluded.milestone_title,
         html_url = excluded.html_url,
         updated_at = excluded.updated_at`
    )
    .bind(
      orgId,
      issue.number,
      issue.title,
      issue.state,
      issue.body ?? "",
      JSON.stringify((issue.assignees ?? []).map((a) => ({ login: a.login }))),
      JSON.stringify((issue.labels ?? []).map((l) => ({ name: l.name, color: l.color }))),
      issue.milestone?.title ?? null,
      issue.html_url,
      issue.created_at,
      issue.updated_at
    )
    .run();
}

export async function upsertPR(db, orgId, repo, pr) {
  await db
    .prepare(
      `INSERT INTO pull_requests (org_id, repo, number, title, state, author, author_avatar, draft, head_ref, base_ref, merged_at, created_at, updated_at, html_url, requested_reviewers_json, labels_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id, repo, number) DO UPDATE SET
         title = excluded.title,
         state = excluded.state,
         author = excluded.author,
         author_avatar = excluded.author_avatar,
         draft = excluded.draft,
         head_ref = excluded.head_ref,
         base_ref = excluded.base_ref,
         merged_at = excluded.merged_at,
         updated_at = excluded.updated_at,
         html_url = excluded.html_url,
         requested_reviewers_json = excluded.requested_reviewers_json,
         labels_json = excluded.labels_json`
    )
    .bind(
      orgId,
      repo,
      pr.number,
      pr.title,
      pr.merged ? "merged" : pr.state,
      pr.user?.login ?? null,
      pr.user?.avatar_url ?? null,
      pr.draft ? 1 : 0,
      pr.head?.ref ?? null,
      pr.base?.ref ?? null,
      pr.merged_at ?? null,
      pr.created_at,
      pr.updated_at,
      pr.html_url,
      JSON.stringify((pr.requested_reviewers ?? []).map((r) => ({ login: r.login }))),
      JSON.stringify((pr.labels ?? []).map((l) => ({ name: l.name, color: l.color })))
    )
    .run();
}

export async function upsertMember(db, orgId, member) {
  await db
    .prepare(
      `INSERT INTO members (org_id, login, avatar_url)
       VALUES (?, ?, ?)
       ON CONFLICT(org_id, login) DO UPDATE SET
         avatar_url = excluded.avatar_url`
    )
    .bind(orgId, member.login, member.avatar_url ?? null)
    .run();
}

export async function removeMember(db, orgId, login) {
  await db
    .prepare("DELETE FROM members WHERE org_id = ? AND login = ?")
    .bind(orgId, login)
    .run();
}

// ---------- Full sync orchestrator (kept for backwards compat, now uses syncInit + syncRepo) ----------

export async function runFullSync(db, token, orgId, orgLogin) {
  const repoNames = await syncInit(db, token, orgId, orgLogin);

  for (const repo of repoNames) {
    await syncRepo(db, token, orgId, orgLogin, repo);
  }

  const prCount = await db
    .prepare("SELECT COUNT(*) as count FROM pull_requests WHERE org_id = ?")
    .bind(orgId)
    .first();

  const issueCount = await db
    .prepare("SELECT COUNT(*) as count FROM issues WHERE org_id = ?")
    .bind(orgId)
    .first();

  const memberCount = await db
    .prepare("SELECT COUNT(*) as count FROM members WHERE org_id = ?")
    .bind(orgId)
    .first();

  return {
    repos: repoNames.length,
    prs: prCount?.count ?? 0,
    issues: issueCount?.count ?? 0,
    members: memberCount?.count ?? 0,
  };
}
