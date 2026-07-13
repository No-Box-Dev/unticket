// GET /api/engineer-stats — per-member counts for the Engineers tab.
//
// Replaces the old client-side approach (download every PR + issue, then run
// O(members x PRs) filters in the browser). All per-member counts are computed
// server-side in a single DB.batch and returned as maps keyed by GitHub login:
//   - openPRs:         open PRs authored by the member                (grid + detail)
//   - reviewing:       open non-draft PRs awaiting their review        (grid + detail)
//   - approvalsGiven:  approvals submitted on other people's PRs       (grid + detail)
//   - mergesOfOthers:  merges of other people's PRs                    (grid + detail)
//   - assignedIssues:  open issues assigned to the member              (grid + detail)
//   - lifetimePRs:     PRs authored, all states                        (detail stat)
//   - prsLast4Weeks:   PRs authored, created in the last 28 days       (detail stat)
//   - issuesClosed:    issues closed by the member                     (detail stat)
//
// Uses the native D1 batch + parameterized SQL (same proven pattern as prs.js /
// issues.js). The reviewer/assignee lists live in JSON-array columns, queried
// with json_each + json_extract. approvalsGiven reads the events table
// (pull_request_review webhooks); mergesOfOthers reads pull_requests.merged_by
// (populated by webhook on merge — historical rows before migration 0034 are
// NULL until an admin backfill fetches per-PR merged_by).

import { getCtx, jsonResponse } from "../lib/db";
import { getActiveRepoNames } from "../lib/inactive-repos";

interface Env {
  DB: D1Database;
}

interface Ctx {
  env: Env;
  data: { orgId: number; orgLogin: string };
}

type CountRow = { login: string | null; c: number };

const EMPTY = {
  openPRs: {},
  reviewing: {},
  approvalsGiven: {},
  mergesOfOthers: {},
  assignedIssues: {},
  lifetimePRs: {},
  prsLast4Weeks: {},
  issuesClosed: {},
};

export async function onRequestGet(context: Ctx): Promise<Response> {
  // getCtx returns context.data, populated by functions/_middleware.js after it
  // authenticates the request and resolves the org. db.js is untyped JS, hence the cast.
  const { orgId, orgLogin } = getCtx(context) as { orgId: number; orgLogin: string };

  const activeRepos: string[] = await getActiveRepoNames(context.env.DB, orgId, orgLogin);
  if (activeRepos.length === 0) return jsonResponse(EMPTY);

  const db = context.env.DB;
  const repoIn = `repo IN (${activeRepos.map(() => "?").join(",")})`;
  const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();

  const [openPRs, reviewing, approvals, merges, assigned, lifetime, recent, closed] =
    await db.batch([
      db
        .prepare(
          `SELECT author AS login, COUNT(*) AS c FROM pull_requests
           WHERE org_id = ? AND state = 'open' AND author IS NOT NULL AND ${repoIn}
           GROUP BY author`,
        )
        .bind(orgId, ...activeRepos),
      db
        .prepare(
          `SELECT json_extract(value, '$.login') AS login, COUNT(*) AS c
           FROM pull_requests, json_each(requested_reviewers_json)
           WHERE org_id = ? AND state = 'open' AND draft = 0
             AND requested_reviewers_json != '[]' AND ${repoIn}
           GROUP BY login`,
        )
        .bind(orgId, ...activeRepos),
      // events.org is the login string (not org_id). Self-approvals are excluded
      // by comparing the review author to the PR author from the slimmed payload;
      // rows missing either field (some pre-slimPayload reconciled reviews) drop
      // out via the IS NOT NULL guard, which undercounts safely rather than
      // double-counting self-approvals.
      //
      // Dedup: the same approval lands twice — once from the pull_request_review
      // webhook (storeEvent, GitHub-delivery-id), once from the 30-min reconcile
      // over /repos/{owner}/{repo}/events (reconcile:<org>:<repo>:gh-event-<id>).
      // Different delivery_ids, so the UNIQUE constraint can't dedupe them. We
      // group by the true review identity (reviewer + repo + PR# + submitted_at)
      // inside a subquery, then count reviewers. COALESCE to events.id keeps
      // rows with missing metadata from collapsing into a single bucket.
      db
        .prepare(
          `SELECT login, COUNT(*) AS c FROM (
             SELECT
               json_extract(payload_json, '$.review.author') AS login,
               repo AS r,
               COALESCE(CAST(json_extract(payload_json, '$.pr.number') AS INTEGER), id) AS pr_num,
               COALESCE(json_extract(payload_json, '$.review.submitted_at'), id) AS ts
             FROM events
             WHERE org = ? AND type = 'github:pr:review:approved'
               AND ${repoIn}
               AND json_extract(payload_json, '$.review.author') IS NOT NULL
               AND json_extract(payload_json, '$.review.author')
                   != json_extract(payload_json, '$.pr.author')
             GROUP BY login, r, pr_num, ts
           )
           GROUP BY login`,
        )
        .bind(orgLogin, ...activeRepos),
      db
        .prepare(
          `SELECT merged_by AS login, COUNT(*) AS c FROM pull_requests
           WHERE org_id = ? AND merged_at IS NOT NULL
             AND merged_by IS NOT NULL AND merged_by != author
             AND ${repoIn}
           GROUP BY merged_by`,
        )
        .bind(orgId, ...activeRepos),
      db
        .prepare(
          `SELECT json_extract(value, '$.login') AS login, COUNT(*) AS c
           FROM issues, json_each(assignees_json)
           WHERE org_id = ? AND state = 'open' AND assignees_json != '[]' AND ${repoIn}
           GROUP BY login`,
        )
        .bind(orgId, ...activeRepos),
      db
        .prepare(
          `SELECT author AS login, COUNT(*) AS c FROM pull_requests
           WHERE org_id = ? AND author IS NOT NULL AND ${repoIn}
           GROUP BY author`,
        )
        .bind(orgId, ...activeRepos),
      db
        .prepare(
          `SELECT author AS login, COUNT(*) AS c FROM pull_requests
           WHERE org_id = ? AND author IS NOT NULL AND created_at >= ? AND ${repoIn}
           GROUP BY author`,
        )
        .bind(orgId, fourWeeksAgo, ...activeRepos),
      db
        .prepare(
          `SELECT closed_by AS login, COUNT(*) AS c FROM issues
           WHERE org_id = ? AND state = 'closed' AND closed_by IS NOT NULL AND ${repoIn}
           GROUP BY closed_by`,
        )
        .bind(orgId, ...activeRepos),
    ]);

  return jsonResponse({
    openPRs: toCountMap(openPRs.results),
    reviewing: toCountMap(reviewing.results),
    approvalsGiven: toCountMap(approvals.results),
    mergesOfOthers: toCountMap(merges.results),
    assignedIssues: toCountMap(assigned.results),
    lifetimePRs: toCountMap(lifetime.results),
    prsLast4Weeks: toCountMap(recent.results),
    issuesClosed: toCountMap(closed.results),
  });
}

function toCountMap(rows: unknown[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const raw of rows as CountRow[]) {
    if (raw.login) map[raw.login] = Number(raw.c);
  }
  return map;
}
