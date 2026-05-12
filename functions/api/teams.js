import { getCtx, jsonResponse, errorResponse } from "../lib/db";

// GET /api/teams — list teams in the org with membership map.
// Returns { teams: [{slug, name}], memberships: { [login]: [team_name, ...] } }.
// Reads from D1; populated by syncTeams (manual sync + cron) and the
// team / membership webhooks.
export async function onRequestGet(context) {
  const { orgId, orgLogin } = getCtx(context);
  if (!orgLogin) return errorResponse("Missing org context", 400);

  const teamRows = await context.env.DB
    .prepare("SELECT github_id, slug, name FROM teams WHERE org_id = ? ORDER BY name")
    .bind(orgId)
    .all();

  const membershipRows = await context.env.DB
    .prepare(
      `SELECT t.name AS team_name, m.login
       FROM team_memberships m
       JOIN teams t ON t.github_id = m.team_github_id AND t.org_id = m.org_id
       WHERE m.org_id = ?`
    )
    .bind(orgId)
    .all();

  const memberships = {};
  for (const row of membershipRows.results ?? []) {
    if (!memberships[row.login]) memberships[row.login] = [];
    memberships[row.login].push(row.team_name);
  }

  return jsonResponse({
    teams: (teamRows.results ?? []).map((t) => ({ slug: t.slug, name: t.name })),
    memberships,
  });
}
