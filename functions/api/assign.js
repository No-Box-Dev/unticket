import { getCtx, jsonResponse, errorResponse } from "../lib/db";
import { getInstallationIdForOrg, getInstallationToken } from "../lib/github-app";

// POST /api/assign — update issue assignees on GitHub and in D1.
//
// Uses the GitHub App installation token (NOT the caller's OAuth token), so
// any logged-in user can change assignees regardless of their personal
// permissions on the target repo. Matches the feature kanban auth model;
// see the audit in functions/api/features/[number].js for the rationale.
export async function onRequestPost(context) {
  const { orgId, orgLogin } = getCtx(context);
  if (!orgLogin) return errorResponse("Missing org context", 400);

  let body;
  try { body = await context.request.json(); } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  const { repo, issue_number, assignees } = body;

  if (!repo || !issue_number || !Array.isArray(assignees)) {
    return errorResponse("Missing repo, issue_number, or assignees");
  }

  // Validate inputs to prevent path traversal and injection
  if (typeof repo !== "string" || !/^[\w.-]+$/.test(repo)) {
    return errorResponse("Invalid repo name", 400);
  }
  if (!Number.isInteger(issue_number) || issue_number <= 0) {
    return errorResponse("Invalid issue_number", 400);
  }
  if (!assignees.every((a) => typeof a === "string" && /^[a-zA-Z0-9-]+$/.test(a))) {
    return errorResponse("Invalid assignee username", 400);
  }

  const installationId = await getInstallationIdForOrg(context.env.DB, orgId);
  if (!installationId) return errorResponse("GitHub App not installed for this org", 412);

  let token;
  try {
    token = await getInstallationToken(context.env, installationId);
  } catch (err) {
    console.error("[assign] install token fetch failed", { msg: err?.message });
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
      body: JSON.stringify({ assignees }),
    },
  );

  if (!ghRes.ok) {
    const body = await ghRes.json().catch(() => ({}));
    return errorResponse(body.message || `GitHub API error: ${ghRes.status}`, ghRes.status);
  }

  const ghIssue = await ghRes.json();

  const assigneesJson = JSON.stringify(
    (ghIssue.assignees || []).map((a) => ({
      login: a.login,
      avatar_url: a.avatar_url || "",
    })),
  );

  await context.env.DB.prepare(
    "UPDATE issues SET assignees_json = ? WHERE org_id = ? AND repo = ? AND number = ?",
  )
    .bind(assigneesJson, orgId, repo, issue_number)
    .run();

  return jsonResponse({
    assignees: (ghIssue.assignees || []).map((a) => ({
      login: a.login,
      avatar_url: a.avatar_url || "",
    })),
  });
}
