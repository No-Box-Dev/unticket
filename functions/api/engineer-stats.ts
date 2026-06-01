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
// The reviewer/assignee lists live in JSON-array columns (`*_json`), so those
// queries use json_each + json_extract via Drizzle's raw `sql` template. The
// per-engineer detail *lists* (not counts) are fetched on demand by the tab.

import { sql } from "drizzle-orm";
import { getCtx, jsonResponse } from "../lib/db";
import { getActiveRepoNames } from "../lib/inactive-repos";
import { getDb } from "../lib/db-client";

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
  const { orgId, orgLogin } = getCtx(context) as { orgId: number; orgLogin: string };

  const activeRepos: string[] = await getActiveRepoNames(context.env.DB, orgId, orgLogin);
  if (activeRepos.length === 0) return jsonResponse(EMPTY);

  const db = getDb(context.env);
  const repoFilter = sql`AND repo IN (${sql.join(
    activeRepos.map((r) => sql`${r}`),
    sql`, `,
  )})`;
  const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();

  const [openPRsRows, reviewingRows, assignedRows, lifetimeRows, recentRows, closedRows] =
    await db.batch([
      db.all<CountRow>(sql`
        SELECT author AS login, COUNT(*) AS c
        FROM pull_requests
        WHERE org_id = ${orgId} AND state = 'open' AND author IS NOT NULL ${repoFilter}
        GROUP BY author
      `),
      db.all<CountRow>(sql`
        SELECT json_extract(value, '$.login') AS login, COUNT(*) AS c
        FROM pull_requests, json_each(requested_reviewers_json)
        WHERE org_id = ${orgId} AND state = 'open' AND draft = 0
          AND requested_reviewers_json != '[]' ${repoFilter}
        GROUP BY login
      `),
      db.all<CountRow>(sql`
        SELECT json_extract(value, '$.login') AS login, COUNT(*) AS c
        FROM issues, json_each(assignees_json)
        WHERE org_id = ${orgId} AND state = 'open'
          AND assignees_json != '[]' ${repoFilter}
        GROUP BY login
      `),
      db.all<CountRow>(sql`
        SELECT author AS login, COUNT(*) AS c
        FROM pull_requests
        WHERE org_id = ${orgId} AND author IS NOT NULL ${repoFilter}
        GROUP BY author
      `),
      db.all<CountRow>(sql`
        SELECT author AS login, COUNT(*) AS c
        FROM pull_requests
        WHERE org_id = ${orgId} AND author IS NOT NULL
          AND created_at >= ${fourWeeksAgo} ${repoFilter}
        GROUP BY author
      `),
      db.all<CountRow>(sql`
        SELECT closed_by AS login, COUNT(*) AS c
        FROM issues
        WHERE org_id = ${orgId} AND state = 'closed' AND closed_by IS NOT NULL ${repoFilter}
        GROUP BY closed_by
      `),
    ]);

  return jsonResponse({
    openPRs: toCountMap(openPRsRows),
    reviewing: toCountMap(reviewingRows),
    assignedIssues: toCountMap(assignedRows),
    lifetimePRs: toCountMap(lifetimeRows),
    prsLast4Weeks: toCountMap(recentRows),
    issuesClosed: toCountMap(closedRows),
  });
}

function toCountMap(rows: CountRow[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows) {
    if (row.login) map[row.login] = Number(row.c);
  }
  return map;
}
