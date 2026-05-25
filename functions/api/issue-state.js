import { getCtx, jsonResponse, errorResponse } from "../lib/db";
import { getInstallationIdForOrg, getInstallationToken } from "../lib/github-app";

// POST /api/issue-state — close or reopen a GitHub issue and update D1.
//
// Uses the GitHub App installation token (NOT the caller's OAuth token), so
// any logged-in user can open/close issues regardless of their personal
// permissions on the target repo. Matches the feature kanban auth model.
export async function onRequestPost(context) {
  const { orgId, orgLogin } = getCtx(context);
  if (!orgLogin) return errorResponse("Missing org context", 400);

  let body;
  try { body = await context.request.json(); } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  const { repo, issue_number, state } = body;

  if (!repo || !issue_number || !state) {
    return errorResponse("Missing repo, issue_number, or state", 400);
  }
  if (typeof repo !== "string" || !/^[\w.-]+$/.test(repo)) {
    return errorResponse("Invalid repo name", 400);
  }
  if (!Number.isInteger(issue_number) || issue_number <= 0) {
    return errorResponse("Invalid issue_number", 400);
  }
  if (state !== "open" && state !== "closed") {
    return errorResponse("state must be 'open' or 'closed'", 400);
  }

  const installationId = await getInstallationIdForOrg(context.env.DB, orgId);
  if (!installationId) return errorResponse("GitHub App not installed for this org", 412);

  let token;
  try {
    token = await getInstallationToken(context.env, installationId);
  } catch (err) {
    console.error("[issue-state] install token fetch failed", { msg: err?.message });
    return errorResponse("Failed to acquire GitHub App token", 500);
  }

  const ghRes = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(orgLogin)}/${encodeURIComponent(repo)}/issues/${issue_number}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Unticket",
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state }),
    },
  );

  if (!ghRes.ok) {
    const ghBody = await ghRes.json().catch(() => ({}));
    return errorResponse(ghBody.message || `GitHub API error: ${ghRes.status}`, ghRes.status);
  }

  const ghIssue = await ghRes.json();

  await context.env.DB.prepare(
    "UPDATE issues SET state = ?, closed_at = ? WHERE org_id = ? AND repo = ? AND number = ?"
  )
    .bind(state, ghIssue.closed_at ?? null, orgId, repo, issue_number)
    .run();

  return jsonResponse({ ok: true, state, closed_at: ghIssue.closed_at ?? null });
}
