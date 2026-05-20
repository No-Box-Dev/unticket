import { getCtx, jsonResponse, errorResponse } from "../lib/db";

// GET /api/op-failures — admin-only view of background operation failures.
// These are errors swallowed by `context.waitUntil(...)` (narrate, match,
// bootstrap, backfill) that would otherwise only land in worker logs. The
// table is small and append-only; we cap the response to keep payloads bounded.
const MAX_ROWS = 100;
const DEFAULT_ROWS = 25;

export async function onRequestGet(context) {
  const { orgLogin, isAdmin } = getCtx(context);
  if (!orgLogin) return errorResponse("Missing org context", 400);
  if (!isAdmin) return errorResponse("Admin required", 403);

  const url = new URL(context.request.url);
  const requested = Number(url.searchParams.get("limit")) || DEFAULT_ROWS;
  const limit = Math.max(1, Math.min(MAX_ROWS, requested));

  const rows = await context.env.DB
    .prepare(
      `SELECT id, op, delivery_id, error, occurred_at
         FROM op_failures
        WHERE owner_id = ?
        ORDER BY occurred_at DESC, id DESC
        LIMIT ?`
    )
    .bind(orgLogin, limit)
    .all();

  return jsonResponse({ failures: rows.results ?? [] });
}
