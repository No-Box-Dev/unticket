import { getCtx, jsonResponse } from "../lib/db";
import { getInactiveRepoSet } from "../lib/inactive-repos";

// GET /api/repos
//   Default: active repos only (drafts, GH-archived, platform-archived, and
//   the unticket-config repo are hidden — consistent with /api/issues + /api/prs).
//   ?include=all  → return everything with an `inactive: true|false` flag so
//   the Settings repo-management UI can render and toggle them. Also includes
//   `discoveredAt` / `acknowledgedAt` so the NewRepoBanner + Settings "Newly
//   detected" section can derive which repos still need admin review.
export async function onRequestGet(context) {
  const { orgId, orgLogin } = getCtx(context);
  const url = new URL(context.request.url);
  const includeAll = url.searchParams.get("include") === "all";

  const [rowsResult, inactive] = await Promise.all([
    context.env.DB
      .prepare(
        `SELECT name, language, pushed_at, discovered_at, acknowledged_at,
                retired_at, retirement_reason, transferred_to
         FROM repos WHERE org_id = ? ORDER BY pushed_at DESC`,
      )
      .bind(orgId)
      .all(),
    getInactiveRepoSet(context.env.DB, orgId, orgLogin),
  ]);

  const rows = (rowsResult.results ?? []).map((r) => ({
    name: r.name,
    language: r.language,
    pushed_at: r.pushed_at,
    discoveredAt: r.discovered_at,
    acknowledgedAt: r.acknowledged_at,
    retiredAt: r.retired_at,
    retirementReason: r.retirement_reason,
    transferredTo: r.transferred_to,
  }));
  if (includeAll) {
    return jsonResponse(rows.map((r) => ({ ...r, inactive: inactive.has(r.name) })));
  }
  return jsonResponse(rows.filter((r) => !inactive.has(r.name)));
}
