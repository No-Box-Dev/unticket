// GET /api/engineer-stats — per-member counts for the Engineers tab.
//
// Replaces the old client-side approach (download every PR + issue, then run
// O(members x PRs) filters in the browser). All per-member counts are computed
// server-side in a single DB.batch and returned as maps keyed by GitHub login:
//   - openPRs:        open PRs authored by the member          (grid + detail)
//   - reviewing:      open non-draft PRs awaiting their review  (grid + detail)
//   - assignedIssues: open issues assigned to the member        (grid + detail)
//   - lifetimePRs:    PRs authored, all states                  (detail stat)
//   - prsLast4Weeks:  PRs authored, created in the last 28 days (detail stat)
//   - issuesClosed:   issues closed by the member               (detail stat)
//
// Uses the native D1 batch + parameterized SQL (same proven pattern as prs.js /
// issues.js). The reviewer/assignee lists live in JSON-array columns, queried
// with json_each + json_extract.

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

  const [openPRs, reviewing, assigned, lifetime, recent, closed] = await db.batch([
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
