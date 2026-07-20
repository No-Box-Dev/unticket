import { z } from "zod";
import { getCtx, jsonResponse, errorResponse } from "../../lib/db";
import { getInstallationIdForOrg, getInstallationToken } from "../../lib/github-app";
import { validate } from "../../lib/validate";

interface Env {
  DB: D1Database;
}

interface Ctx {
  env: Env;
  data: { orgId: number; orgLogin: string; isAdmin: boolean };
  request: Request;
}

const CloseBody = z.object({
  repo: z.string().regex(/^[\w.-]+$/, "Invalid repo name").max(100),
  number: z.number().int().positive(),
});

// POST /api/prs/close — close (without merging) a PR on GitHub, mirror to D1.
//
// Admin-gated because closing another user's PR is destructive from the
// author's point of view (their branch/CI/reviewer flow all get interrupted).
// Uses the GitHub App installation token so any admin can close regardless
// of personal repo permissions — same auth model as /api/assign.ts and
// the feature endpoints.
export async function onRequestPost(context: Ctx): Promise<Response> {
  const { orgId, orgLogin, isAdmin } = getCtx(context) as {
    orgId: number;
    orgLogin: string;
    isAdmin: boolean;
  };
  if (!orgLogin) return errorResponse("Missing org context", 400);
  if (!isAdmin) return errorResponse("Admin required", 403);

  let rawBody: unknown;
  try {
    rawBody = await context.request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  const parsed = validate(CloseBody, rawBody);
  if (!parsed.ok) return parsed.response;
  const { repo, number } = parsed.data;

  const installationId = await getInstallationIdForOrg(context.env.DB, orgId);
  if (!installationId) return errorResponse("GitHub App not installed for this org", 412);

  let token: string;
  try {
    token = await getInstallationToken(context.env, installationId);
  } catch (err) {
    console.error("[prs/close] install token fetch failed", { msg: (err as Error)?.message });
    return errorResponse("Failed to acquire GitHub App token", 500);
  }

  const ghRes = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(orgLogin)}/${encodeURIComponent(repo)}/pulls/${number}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Unticket",
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state: "closed" }),
    },
  );

  if (!ghRes.ok) {
    const errBody = (await ghRes.json().catch(() => ({}))) as { message?: string };
    return errorResponse(errBody.message || `GitHub API error: ${ghRes.status}`, ghRes.status);
  }

  // Mirror the state change in D1 so the UI reflects it without waiting for
  // the next webhook. Kept minimal — the webhook / cron reconcile will fill
  // in merged_at / closed_by / any other columns.
  await context.env.DB.prepare(
    `UPDATE pull_requests
        SET state = 'closed', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE org_id = ? AND repo = ? AND number = ?`,
  )
    .bind(orgId, repo, number)
    .run();

  return jsonResponse({ ok: true, repo, number, state: "closed" });
}
