import { getCtx, jsonResponse, errorResponse } from "../lib/db";

// POST /api/assign — update issue assignees on GitHub and in D1
export async function onRequestPost(context) {
  const { orgId, orgLogin, token } = getCtx(context);
  const { repo, issue_number, assignees } = await context.request.json();

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

  // Update on GitHub
  const ghRes = await fetch(
    `https://api.github.com/repos/${orgLogin}/${repo}/issues/${issue_number}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "GitPulse",
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

  // Update D1 cache
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
