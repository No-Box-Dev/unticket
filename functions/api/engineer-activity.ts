// GET /api/engineer-activity?login=X&month=YYYY-MM — daily contribution counts
// for one engineer for a single month, for the People-tab activity table.
// Two metrics, both from D1:
//   - prsOpened:   PRs authored, by day (pull_requests — full history)
//   - prsReviewed: distinct PRs they reviewed, by day (review events — only
//                  since the GitHub App was installed; older months read 0)
// `month` defaults to the current month. `firstMonth` (earliest month with any
// activity) is returned as the month selector's lower bound.

import { z } from "zod";
import { getCtx, jsonResponse } from "../lib/db";
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
         GROUP BY k`,
      )
      .bind(orgId, login, month),
    // [1] earliest PR month (selector lower bound)
    db
      .prepare(
        `SELECT MIN(strftime('%Y-%m', created_at)) AS k, 0 AS c
         FROM pull_requests WHERE org_id = ? AND author = ?`,
      )
      .bind(orgId, login),
  ];
  if (actorId) {
    statements.push(
      // [2] PRs reviewed, by day, within the month
      db
        .prepare(
          `SELECT strftime('%Y-%m-%d', created_at) AS k,
                  COUNT(DISTINCT json_extract(payload_json, '$.pr.number')) AS c
           FROM events
           WHERE org = ? AND actor_id = ? AND type LIKE 'github:pr:review:%'
             AND strftime('%Y-%m', created_at) = ?
           GROUP BY k`,
        )
        .bind(orgLogin, actorId, month),
      // [3] earliest review month
      db
        .prepare(
          `SELECT MIN(strftime('%Y-%m', created_at)) AS k, 0 AS c
           FROM events WHERE org = ? AND actor_id = ? AND type LIKE 'github:pr:review:%'`,
        )
        .bind(orgLogin, actorId),
    );
  }

  const results = await db.batch(statements);
  const prsOpened = toCountMap(results[0].results);
  const prsReviewed = actorId ? toCountMap(results[2].results) : {};

  const firstMonthCandidates = [
    (results[1].results[0] as KeyedRow | undefined)?.k,
    actorId ? (results[3].results[0] as KeyedRow | undefined)?.k : null,
  ].filter((v): v is string => !!v);
  const firstMonth = firstMonthCandidates.sort()[0] ?? null;

  return jsonResponse({ login, month, firstMonth, prsOpened, prsReviewed });
}

function toCountMap(rows: unknown[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const raw of rows as KeyedRow[]) {
    if (raw.k) map[raw.k] = Number(raw.c);
  }
  return map;
}
