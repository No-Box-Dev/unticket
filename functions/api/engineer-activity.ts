// GET /api/engineer-activity?login=X — per-month contribution counts for one
// engineer, for the People-tab activity table. Two metrics, both from D1:
//   - prsOpened:   PRs authored, by month (pull_requests — full history)
//   - prsReviewed: distinct PRs they reviewed, by month (review events —
//                  only since the GitHub App was installed; older months read 0)
// Returns maps keyed by "YYYY-MM" plus the first month with any activity (the
// month selector's lower bound).

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
});

type CountRow = { m: string | null; c: number };

export async function onRequestGet(context: Ctx): Promise<Response> {
  const { orgId, orgLogin } = getCtx(context) as { orgId: number; orgLogin: string };

  const url = new URL(context.request.url);
  const parsed = validate(Query, { login: url.searchParams.get("login") });
  if (!parsed.ok) return parsed.response;
  const { login } = parsed.data;

  const db = context.env.DB;

  // Reviews are attributed via the actor row (actors.name = GitHub login).
  const actor = await db
    .prepare("SELECT id FROM actors WHERE name = ? AND owner_id = ?")
    .bind(login, orgLogin)
    .first();
  const actorId = (actor?.id as string | undefined) ?? null;

  const statements = [
    db
      .prepare(
        `SELECT strftime('%Y-%m', created_at) AS m, COUNT(*) AS c
         FROM pull_requests
         WHERE org_id = ? AND author = ?
         GROUP BY m`,
      )
      .bind(orgId, login),
  ];
  if (actorId) {
    statements.push(
      db
        .prepare(
          `SELECT strftime('%Y-%m', created_at) AS m,
                  COUNT(DISTINCT json_extract(payload_json, '$.pr.number')) AS c
           FROM events
           WHERE org = ? AND actor_id = ? AND type LIKE 'github:pr:review:%'
           GROUP BY m`,
        )
        .bind(orgLogin, actorId),
    );
  }

  const results = await db.batch(statements);
  const prsOpened = toCountMap(results[0].results);
  const prsReviewed = actorId ? toCountMap(results[1].results) : {};

  const firstMonth =
    [...Object.keys(prsOpened), ...Object.keys(prsReviewed)].sort()[0] ?? null;

  return jsonResponse({ login, firstMonth, prsOpened, prsReviewed });
}

function toCountMap(rows: unknown[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const raw of rows as CountRow[]) {
    if (raw.m) map[raw.m] = Number(raw.c);
  }
  return map;
}
