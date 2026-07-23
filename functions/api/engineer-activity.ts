// GET /api/engineer-activity?login=X&month=YYYY-MM — daily contribution counts
// for one engineer for a single month, for the People-tab activity table.
// All metrics are restricted to the same tracked/active repository set used by
// engineer-stats, so the daily chart and headline cards always reconcile.
// Two metrics, both from D1:
//   - prsOpened:   PRs authored, by day (pull_requests — full history)
//   - prsReviewed: distinct PRs they reviewed, by day (review events — only
//                  since the GitHub App was installed; older months read 0)
// `month` defaults to the current month. Monthly totals and `firstMonth` are
// returned for the trend chart and month selector.

import { z } from "zod";
import { getCtx, jsonResponse } from "../lib/db";
import { getActiveRepoNames } from "../lib/inactive-repos";
import { validate } from "../lib/validate";

interface Env {
  DB: D1Database;
}

interface Ctx {
  env: Env;
  data: { orgId: number; orgLogin: string };
  request: Request;
}

const Query = z.object({
  login: z.string().regex(/^[a-zA-Z0-9-]+$/, "Invalid login"),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Invalid month").optional(),
});

type KeyedRow = { k: string | null; c: number };

export async function onRequestGet(context: Ctx): Promise<Response> {
  const { orgId, orgLogin } = getCtx(context) as { orgId: number; orgLogin: string };

  const url = new URL(context.request.url);
  const parsed = validate(Query, {
    login: url.searchParams.get("login"),
    month: url.searchParams.get("month") ?? undefined,
  });
  if (!parsed.ok) return parsed.response;
  const { login } = parsed.data;

  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const month = parsed.data.month ?? currentMonth;

  const db = context.env.DB;
  const activeRepos = await getActiveRepoNames(db, orgId, orgLogin);
  if (activeRepos.length === 0) {
    return jsonResponse({
      login,
      month,
      firstMonth: null,
      prsOpened: {},
      prsReviewed: {},
      monthlyOpened: {},
      monthlyReviewed: {},
    });
  }
  const repoIn = `repo IN (${activeRepos.map(() => "?").join(",")})`;

  // Reviews are attributed via the actor row (actors.name = GitHub login).
  const actor = await db
    .prepare("SELECT id FROM actors WHERE name = ? AND owner_id = ?")
    .bind(login, orgLogin)
    .first();
  const actorId = (actor?.id as string | undefined) ?? null;

  const statements = [
    // [0] PRs opened, by day, within the month
    db
      .prepare(
        `SELECT strftime('%Y-%m-%d', created_at) AS k, COUNT(*) AS c
         FROM pull_requests
         WHERE org_id = ? AND author = ? AND strftime('%Y-%m', created_at) = ?
           AND ${repoIn}
         GROUP BY k`,
      )
      .bind(orgId, login, month, ...activeRepos),
    // [1] PRs opened by month — powers the longer-range trend chart.
    db
      .prepare(
        `SELECT strftime('%Y-%m', created_at) AS k, COUNT(*) AS c
         FROM pull_requests
         WHERE org_id = ? AND author = ? AND ${repoIn}
         GROUP BY k`,
      )
      .bind(orgId, login, ...activeRepos),
  ];
  if (actorId) {
    statements.push(
      // [2] PRs reviewed, by day, within the month
      db
        .prepare(
          `SELECT strftime('%Y-%m-%d', COALESCE(json_extract(payload_json, '$.review.submitted_at'), created_at)) AS k,
                  COUNT(DISTINCT repo || '#' || CAST(json_extract(payload_json, '$.pr.number') AS TEXT)) AS c
           FROM events
           WHERE org = ? AND actor_id = ? AND type LIKE 'github:pr:review:%'
             AND strftime('%Y-%m', COALESCE(json_extract(payload_json, '$.review.submitted_at'), created_at)) = ?
             AND ${repoIn}
           GROUP BY k`,
        )
        .bind(orgLogin, actorId, month, ...activeRepos),
      // [3] Distinct PRs reviewed by month. Qualifying with the repo avoids
      // collapsing e.g. api#42 and web#42 into a single review.
      db
        .prepare(
          `SELECT k, COUNT(*) AS c FROM (
             SELECT
               strftime('%Y-%m', COALESCE(json_extract(payload_json, '$.review.submitted_at'), created_at)) AS k,
               repo,
               json_extract(payload_json, '$.pr.number') AS pr_number
             FROM events
             WHERE org = ? AND actor_id = ? AND type LIKE 'github:pr:review:%'
               AND ${repoIn}
               AND json_extract(payload_json, '$.pr.number') IS NOT NULL
             GROUP BY k, repo, pr_number
           )
           GROUP BY k`,
        )
        .bind(orgLogin, actorId, ...activeRepos),
    );
  }

  const results = await db.batch(statements);
  const prsOpened = toCountMap(results[0].results);
  const prsReviewed = actorId ? toCountMap(results[2].results) : {};
  const monthlyOpened = toCountMap(results[1].results);
  const monthlyReviewed = actorId ? toCountMap(results[3].results) : {};
  const firstMonthCandidates = [
    ...Object.keys(monthlyOpened),
    ...Object.keys(monthlyReviewed),
  ];
  const firstMonth = firstMonthCandidates.sort()[0] ?? null;

  return jsonResponse({
    login,
    month,
    firstMonth,
    prsOpened,
    prsReviewed,
    monthlyOpened,
    monthlyReviewed,
  });
}

function toCountMap(rows: unknown[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const raw of rows as KeyedRow[]) {
    if (raw.k) map[raw.k] = Number(raw.c);
  }
  return map;
}
