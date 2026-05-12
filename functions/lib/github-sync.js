import { getSyncState, setSyncState } from "./db";
import { parseFeatureMetadata, parseFeatureFromBranch, parseFeaturesFromBody } from "./feature-metadata";
import { filterInactive, getUnticketRepoName } from "./inactive-repos";
import { getInstallationToken } from "./github-app";
import { upsertGhUser } from "./gh-mirror";

// Paginated GitHub API fetcher.
// MAX_PAGES caps any single resource sync at 5000 items (50 pages × 100/page).
// The number is a Cloudflare Worker CPU-budget guard: at 50ms/page (cold cache,
// GH p99) a 50-page sync stays well under the 30s Pages Functions limit. Bump
// only if you also split the call across multiple invocations.
const MAX_PAGES = 50;

async function fetchAllPages(token, url, params = {}) {
  const all = [];
  let page = 1;

  while (page <= MAX_PAGES) {
    const searchParams = new URLSearchParams({
      ...params,
      per_page: "100",
      page: String(page),
    });

    const res = await fetch(`${url}?${searchParams}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Unticket",
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

  return repos.map((r) => r.name);
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

  // Mirror PR authors into gh_users so the cron's missed-merge narration
  // path can resolve login → user_id (resolveActorFromGithub requires id).
  // Webhook handlers already upsert; this fills the gap for PRs that only
  // ever arrive via the sync API (e.g. a missed webhook delivery).
  const seenUserIds = new Set();
  for (const pr of prs) {
    if (!pr.user?.id || seenUserIds.has(pr.user.id)) continue;
    seenUserIds.add(pr.user.id);
    try {
      await upsertGhUser(db, {
        id: pr.user.id,
        login: pr.user.login,
        avatar_url: pr.user.avatar_url ?? null,
        type: pr.user.type === "Bot" ? "Bot" : "User",
        name: null,
      });
    } catch (err) {
      console.error("[unticket sync] upsertGhUser failed:", err?.message ?? err);
    }
  }

  // Auto-detect feature links from branch names + PR bodies
  const linkStmt = db.prepare(
    `INSERT INTO pr_feature_links (org_id, feature_number, pr_repo, pr_number, source)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(org_id, feature_number, pr_repo, pr_number) DO NOTHING`
  );
  const allLinks = [];
  for (const pr of prs) {
    const branchNum = parseFeatureFromBranch(pr.head?.ref);
    if (branchNum) allLinks.push(linkStmt.bind(orgId, branchNum, repo, pr.number, "branch"));
    for (const num of parseFeaturesFromBody(pr.body)) {
      allLinks.push(linkStmt.bind(orgId, num, repo, pr.number, "body"));
    }
  }
  for (let i = 0; i < allLinks.length; i += 50) {
    await db.batch(allLinks.slice(i, i + 50));
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

  // Fetch closed_by for closed issues that don't already have it in D1.
  // For incremental syncs, skip this — webhooks already capture closed_by.
  // Only fetch events for issues missing closed_by during full syncs.
  const closedByMap = new Map();
  if (!since) {
    // Full sync: check which closed issues are missing closed_by in D1
    const closedIssues = issues.filter((i) => i.state === "closed");
    if (closedIssues.length > 0) {
      const existingClosedBy = await db
        .prepare(
          `SELECT number, closed_by FROM issues WHERE org_id = ? AND repo = ? AND closed_by IS NOT NULL`
        )
        .bind(orgId, repo)
        .all();
      const knownClosedBy = new Set(existingClosedBy.results.map((r) => r.number));

      const missingClosedBy = closedIssues.filter((i) => !knownClosedBy.has(i.number));
      const BATCH_SIZE = 20;
      for (let i = 0; i < missingClosedBy.length; i += BATCH_SIZE) {
        const batch = missingClosedBy.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (issue) => {
            const eventsRes = await fetch(
              `https://api.github.com/repos/${orgLogin}/${repo}/issues/${issue.number}/events?per_page=100`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  "User-Agent": "Unticket",
                  Accept: "application/vnd.github+json",
                },
              }
            );
            if (!eventsRes.ok) return { number: issue.number, login: null };
            let events;
            try {
              events = await eventsRes.json();
            } catch {
              console.error(`[unticket] Failed to parse events JSON for issue #${issue.number}`);
              return { number: issue.number, login: null };
            }
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

  // Reconcile: on a full sync the GitHub response is the authoritative list.
  // Delete D1 rows for issues GitHub no longer returns — those were
  // transferred to another repo or deleted, and were leaving phantom
  // "open" rows that skewed the by-repo chart.
  if (!since) {
    const fetchedNumbers = new Set(issues.map((i) => i.number));
    const existing = await db
      .prepare("SELECT number FROM issues WHERE org_id = ? AND repo = ?")
      .bind(orgId, repo)
      .all();
    const stale = existing.results
      .map((r) => r.number)
      .filter((n) => !fetchedNumbers.has(n));
    if (stale.length > 0) {
      const CHUNK = 90;
      for (let i = 0; i < stale.length; i += CHUNK) {
        const chunk = stale.slice(i, i + CHUNK);
        const placeholders = chunk.map(() => "?").join(", ");
        await db
          .prepare(`DELETE FROM issues WHERE org_id = ? AND repo = ? AND number IN (${placeholders})`)
          .bind(orgId, repo, ...chunk)
          .run();
      }
      console.log(`[unticket] syncIssues: deleted ${stale.length} stale issues from D1 for ${repo}`);
    }
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

  return members.map((m) => m.login);
}

// ---------- Sync Teams ----------
//
// Full reconcile each tick: GitHub orgs rarely have >100 teams, and per-team
// member lists are short. Deletions are handled by clearing rows for teams
// no longer in the API response. Errors are swallowed (403/404 = the
// installation lacks the `members:read` permission, or the org is a user).

export async function syncTeams(db, token, orgId, orgLogin) {
  let teams;
  try {
    teams = await fetchAllPages(token, `https://api.github.com/orgs/${orgLogin}/teams`);
  } catch (err) {
    console.error(`[unticket sync] syncTeams ${orgLogin} failed:`, err?.message ?? err);
    return [];
  }

  const teamRows = teams.map((t) => ({ id: t.id, slug: t.slug, name: t.name }));

  const teamStmt = db.prepare(
    `INSERT INTO teams (org_id, github_id, slug, name, updated_at)
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
     ON CONFLICT(org_id, github_id) DO UPDATE SET
       slug = excluded.slug,
       name = excluded.name,
       updated_at = excluded.updated_at`
  );

  if (teamRows.length > 0) {
    await db.batch(teamRows.map((t) => teamStmt.bind(orgId, t.id, t.slug, t.name)));
  }

  const keepIds = new Set(teamRows.map((t) => t.id));
  const existing = await db
    .prepare("SELECT github_id FROM teams WHERE org_id = ?")
    .bind(orgId)
    .all();
  const toDelete = (existing.results ?? [])
    .map((r) => r.github_id)
    .filter((id) => !keepIds.has(id));
  if (toDelete.length > 0) {
    const placeholders = toDelete.map(() => "?").join(",");
    await db.batch([
      db.prepare(`DELETE FROM teams WHERE org_id = ? AND github_id IN (${placeholders})`).bind(orgId, ...toDelete),
      db.prepare(`DELETE FROM team_memberships WHERE org_id = ? AND team_github_id IN (${placeholders})`).bind(orgId, ...toDelete),
    ]);
  }

  const membershipStmt = db.prepare(
    `INSERT INTO team_memberships (org_id, team_github_id, login)
     VALUES (?, ?, ?)
     ON CONFLICT(org_id, team_github_id, login) DO NOTHING`
  );

  for (const team of teamRows) {
    let members;
    try {
      members = await fetchAllPages(
        token,
        `https://api.github.com/orgs/${orgLogin}/teams/${team.slug}/members`,
      );
    } catch (err) {
      console.error(`[unticket sync] syncTeams members ${team.slug} failed:`, err?.message ?? err);
      continue;
    }

    const seenLogins = new Set(members.map((m) => m.login).filter(Boolean));

    if (members.length > 0) {
      const ops = members
        .filter((m) => m.login)
        .map((m) => membershipStmt.bind(orgId, team.id, m.login));
      for (let i = 0; i < ops.length; i += 50) {
        await db.batch(ops.slice(i, i + 50));
      }
    }

    const existingMembers = await db
      .prepare("SELECT login FROM team_memberships WHERE org_id = ? AND team_github_id = ?")
      .bind(orgId, team.id)
      .all();
    const staleLogins = (existingMembers.results ?? [])
      .map((r) => r.login)
      .filter((login) => !seenLogins.has(login));
    if (staleLogins.length > 0) {
      const ph = staleLogins.map(() => "?").join(",");
      await db
        .prepare(`DELETE FROM team_memberships WHERE org_id = ? AND team_github_id = ? AND login IN (${ph})`)
        .bind(orgId, team.id, ...staleLogins)
        .run();
    }
  }

  await setSyncState(db, orgId, "teams");

  return teamRows.map((t) => t.slug);
}

// Webhook helpers — call from the team / membership webhook handlers.

export async function upsertTeam(db, orgId, team) {
  if (!team?.id) return;
  await db
    .prepare(
      `INSERT INTO teams (org_id, github_id, slug, name, updated_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
       ON CONFLICT(org_id, github_id) DO UPDATE SET
         slug = excluded.slug,
         name = excluded.name,
         updated_at = excluded.updated_at`
    )
    .bind(orgId, team.id, team.slug, team.name)
    .run();
}

export async function removeTeam(db, orgId, githubId) {
  if (!githubId) return;
  await db.batch([
    db.prepare("DELETE FROM teams WHERE org_id = ? AND github_id = ?").bind(orgId, githubId),
    db.prepare("DELETE FROM team_memberships WHERE org_id = ? AND team_github_id = ?").bind(orgId, githubId),
  ]);
}

export async function addTeamMember(db, orgId, teamGithubId, login) {
  if (!teamGithubId || !login) return;
  await db
    .prepare(
      `INSERT INTO team_memberships (org_id, team_github_id, login)
       VALUES (?, ?, ?)
       ON CONFLICT(org_id, team_github_id, login) DO NOTHING`
    )
    .bind(orgId, teamGithubId, login)
    .run();
}

export async function removeTeamMember(db, orgId, teamGithubId, login) {
  if (!teamGithubId || !login) return;
  await db
    .prepare(
      "DELETE FROM team_memberships WHERE org_id = ? AND team_github_id = ? AND login = ?"
    )
    .bind(orgId, teamGithubId, login)
    .run();
}

// ---------- Sync Features (unticket repo issues) ----------
//
// Always does a full sync. The unticket repo is small (<100 issues) so the
// `since` cursor saved next to nothing, but it broke reconciliation: an
// incremental sync can't know which D1 rows no longer exist on GitHub.

export async function syncFeatures(db, token, orgId, orgLogin) {
  const unticketRepo = await getUnticketRepoName(db, orgId);
  const issues = await fetchAllPages(
    token,
    `https://api.github.com/repos/${encodeURIComponent(orgLogin)}/${encodeURIComponent(unticketRepo)}/issues`,
    { state: "all", sort: "updated", direction: "desc" }
  );

  // Only sync issues that carry BOTH the "unticket" and "feature" labels
  // (filter out PRs, todos, roles, tasks, and legacy single-label items).
  const features = issues.filter((i) => {
    if (i.pull_request) return false;
    const names = (i.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));
    return names.includes("unticket") && names.includes("feature");
  });

  console.log(`[unticket] syncFeatures: ${issues.length} total issues, ${features.length} features (org=${orgLogin})`);

  if (features.length === 0 && issues.length > 0) {
    console.warn(`[unticket] syncFeatures: ${issues.length} issues but 0 features — all PRs? (org=${orgLogin})`);
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

  // Reconcile D1 against the unticket repo. Drops any open rows whose issue
  // number isn't in the current feature set — including legacy rows synced
  // from earlier repo sources.
  const featureNumbers = new Set(features.map((f) => f.number));
  const existing = await db
    .prepare("SELECT number FROM features WHERE org_id = ? AND state = 'open'")
    .bind(orgId)
    .all();
  const toDelete = existing.results
    .filter((r) => !featureNumbers.has(r.number))
    .map((r) => r.number);
  if (toDelete.length > 0) {
    console.log(`[unticket] syncFeatures: cleaning up ${toDelete.length} stale features from D1 (org=${orgLogin})`);
    for (let i = 0; i < toDelete.length; i += 50) {
      const batch = toDelete.slice(i, i + 50);
      await db.batch(
        batch.map((num) =>
          db.prepare("DELETE FROM features WHERE org_id = ? AND number = ?").bind(orgId, num)
        )
      );
    }
  }

  return { synced: features.length, total: issues.length };
}

// ---------- Migrate unticket config ----------

export async function migrateUnticketConfig(db, token, orgId, orgLogin) {
  const existing = await db
    .prepare("SELECT COUNT(*) as count FROM config WHERE org_id = ?")
    .bind(orgId)
    .first();

  if (existing && existing.count > 0) return;

  const repoRes = await fetch(
    `https://api.github.com/repos/${orgLogin}/unticket`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Unticket",
      },
    }
  );

  if (!repoRes.ok) return;

  const files = ["features", "people", "settings"];

  for (const key of files) {
    const fileRes = await fetch(
      `https://api.github.com/repos/${orgLogin}/unticket/contents/${key}.json`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "Unticket",
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
         VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
         ON CONFLICT(org_id, key) DO UPDATE SET
           data = excluded.data,
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`
      )
      .bind(orgId, key, decoded)
      .run();
  }
}

// ---------- syncInit: lightweight init (repos + members + config migration) ----------

export async function syncInit(db, token, orgId, orgLogin) {
  await migrateUnticketConfig(db, token, orgId, orgLogin);
  await syncRepos(db, token, orgId, orgLogin);
  await syncMembers(db, token, orgId, orgLogin);
  await syncTeams(db, token, orgId, orgLogin);
  await syncFeatures(db, token, orgId, orgLogin);

  const repoRows = await db
    .prepare("SELECT name FROM repos WHERE org_id = ? ORDER BY name")
    .bind(orgId)
    .all();

  return repoRows.results.map((r) => r.name);
}

// ---------- bootstrapInstallation: full backfill on install webhook ----------
//
// Fired from the `installation` webhook when a new install (or unsuspend)
// arrives. Pulls everything we need for an empty dashboard so the user
// never has to click Sync. Marks `orgs.bootstrapped_at` on success; the
// dashboard polls this to switch from "setting up" to "ready".
//
// Pulls in dependency order: repos → members → features → per-repo issues+PRs.
// Per-repo work uses the existing incremental syncRepo (force=true to ensure
// a clean slate on first install). Reconciliation cron (Slice 3) catches any
// repos added later via installation_repositories.
export async function bootstrapInstallation(env, orgId, orgLogin, installationId) {
  const db = env.DB;
  const token = await getInstallationToken(env, installationId);

  await syncRepos(db, token, orgId, orgLogin);
  await syncMembers(db, token, orgId, orgLogin);
  await syncTeams(db, token, orgId, orgLogin);
  await syncFeatures(db, token, orgId, orgLogin);

  const repoRows = await db
    .prepare("SELECT name FROM repos WHERE org_id = ? ORDER BY name")
    .bind(orgId)
    .all();
  const repoNames = await filterInactive(
    db,
    orgId,
    orgLogin,
    repoRows.results.map((r) => r.name),
  );

  for (const repo of repoNames) {
    try {
      await syncRepo(db, token, orgId, orgLogin, repo, true);
    } catch (err) {
      // Don't abort the whole bootstrap on one bad repo — cron will retry.
      console.error(`[unticket] bootstrap repo ${repo} failed:`, err?.message ?? err);
    }
  }

  await db
    .prepare("UPDATE orgs SET bootstrapped_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?")
    .bind(orgId)
    .run();
}

// ---------- syncRepo: sync PRs + issues for a single repo ----------

export async function syncRepo(db, token, orgId, orgLogin, repo, force = false) {
  try {
    const prSince = force ? null : (await getSyncState(db, orgId, `prs:${repo}`))?.lastSynced;
    await syncPRs(db, token, orgId, orgLogin, repo, prSince);
  } catch (err) {
    console.error(`[unticket] syncRepo PRs failed for ${repo}:`, err?.message ?? err);
    throw err;
  }

  try {
    const issueSince = force ? null : (await getSyncState(db, orgId, `issues:${repo}`))?.lastSynced;
    await syncIssues(db, token, orgId, orgLogin, repo, issueSince);
  } catch (err) {
    console.error(`[unticket] syncRepo issues failed for ${repo}:`, err?.message ?? err);
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
  // Only upsert if the issue carries BOTH "unticket" and "feature" labels.
  const labels = (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));
  if (!labels.includes("unticket") || !labels.includes("feature")) {
    // Not a feature — remove from features table if it was previously tracked
    await db.prepare("DELETE FROM features WHERE org_id = ? AND number = ?").bind(orgId, issue.number).run();
    return;
  }

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

// Mark a repo as archived on GitHub. Keeps the row so historical issues/PRs
// remain joinable; UI is expected to filter on archived_at IS NULL.
export async function markRepoArchived(db, orgId, repo) {
  await db
    .prepare("UPDATE repos SET archived_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE org_id = ? AND name = ?")
    .bind(orgId, repo)
    .run();
}

// Drop a repo and all of its dependent rows. Used when GitHub fires
// `repository.deleted` or `repository.transferred` — the repo is no
// longer accessible under this org, so its issues and PRs go with it.
// Renames go through `renameRepo` instead so historical rows are kept.
export async function removeRepo(db, orgId, repo) {
  await db.batch([
    db.prepare("DELETE FROM issues WHERE org_id = ? AND repo = ?").bind(orgId, repo),
    db.prepare("DELETE FROM pull_requests WHERE org_id = ? AND repo = ?").bind(orgId, repo),
    db.prepare("DELETE FROM pr_feature_links WHERE org_id = ? AND pr_repo = ?").bind(orgId, repo),
    db.prepare("DELETE FROM repos WHERE org_id = ? AND name = ?").bind(orgId, repo),
  ]);
}

// Rename a repo across every table that stores `repo` as plain text.
// GitHub's `repository.renamed` event carries `changes.repository.name.from`
// and the new name on `repository.name`. Doing the rename in place keeps
// history (issues, PRs, feature links) intact rather than dropping it
// and waiting for the next reconcile to refetch.
export async function renameRepo(db, orgId, fromName, toName) {
  if (!fromName || !toName || fromName === toName) return;
  await db.batch([
    db.prepare("UPDATE repos SET name = ? WHERE org_id = ? AND name = ?").bind(toName, orgId, fromName),
    db.prepare("UPDATE issues SET repo = ? WHERE org_id = ? AND repo = ?").bind(toName, orgId, fromName),
    db.prepare("UPDATE pull_requests SET repo = ? WHERE org_id = ? AND repo = ?").bind(toName, orgId, fromName),
    db.prepare("UPDATE pr_feature_links SET pr_repo = ? WHERE org_id = ? AND pr_repo = ?").bind(toName, orgId, fromName),
  ]);
}

// Update repos.pushed_at from a `push` webhook so the repo list ordering
// (sort: pushed_at desc) stays accurate without waiting for a reconcile.
// ISO 8601 to match the format `syncRepos` copies from GitHub responses —
// mixing space and ISO formats in the same column breaks ORDER BY DESC.
export async function touchRepoPushed(db, orgId, repo) {
  await db
    .prepare(
      "UPDATE repos SET pushed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE org_id = ? AND name = ?"
    )
    .bind(orgId, repo)
    .run();
}

