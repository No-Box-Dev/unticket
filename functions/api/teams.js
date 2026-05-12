import { getCtx, jsonResponse, errorResponse } from "../lib/db";
import { getInstallationToken, getInstallationIdForOrg } from "../lib/github-app";

// GET /api/teams — list teams in the org with membership map.
// Returns { teams: [{slug, name}], memberships: { [login]: [team_name, ...] } }.
// Empty teams + empty memberships when the org has no teams, the install
// lacks the `members:read` permission, or the org is a personal account.
export async function onRequestGet(context) {
  const { orgId, orgLogin } = getCtx(context);
  if (!orgLogin) return errorResponse("Missing org context", 400);

  const installationId = await getInstallationIdForOrg(context.env.DB, orgId);
  if (!installationId) return jsonResponse({ teams: [], memberships: {} });

  let token;
  try {
    token = await getInstallationToken(context.env, installationId);
  } catch (err) {
    console.error("[unticket teams] getInstallationToken failed:", err);
    return jsonResponse({ teams: [], memberships: {} });
  }

  const teams = await fetchAll(token, `https://api.github.com/orgs/${orgLogin}/teams`);
  if (!teams.length) return jsonResponse({ teams: [], memberships: {} });

  const memberships = {};
  for (const team of teams) {
    const members = await fetchAll(
      token,
      `https://api.github.com/orgs/${orgLogin}/teams/${team.slug}/members`,
    );
    for (const m of members) {
      if (!m?.login) continue;
      if (!memberships[m.login]) memberships[m.login] = [];
      memberships[m.login].push(team.name);
    }
  }

  return jsonResponse({
    teams: teams.map((t) => ({ slug: t.slug, name: t.name })),
    memberships,
  });
}

async function fetchAll(token, url) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${url}?per_page=100&page=${page}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "unticket",
      },
    });
    if (res.status === 404 || res.status === 403) return all;
    if (!res.ok) {
      console.error(`[unticket teams] ${url} ${res.status}`);
      return all;
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return all;
    all.push(...data);
    if (data.length < 100) return all;
  }
  return all;
}
