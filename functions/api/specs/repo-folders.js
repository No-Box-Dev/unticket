import { getCtx, jsonResponse, errorResponse } from "../../lib/db";
import { listRepoFolders } from "../../lib/specs";

// GET /api/specs/repo-folders?repo=owner/repo
//
// Lists every folder path in the repo (up to 4 levels deep, 500 entries)
// so the Settings → Specs source UI can render the Root folder field as
// a dropdown of actual subfolders instead of a free-text input. Admin-
// only because the same gate covers the underlying settings.specs PUT.
export async function onRequestGet(context) {
  const { isAdmin } = getCtx(context);
  if (!isAdmin) return errorResponse("Admin required", 403);

  const url = new URL(context.request.url);
  const repo = url.searchParams.get("repo");
  if (!repo || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) {
    return errorResponse("Missing or invalid 'repo' (expected owner/repo)", 400);
  }

  try {
    const result = await listRepoFolders(context.env, repo);
    return jsonResponse(result);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err), 502);
  }
}
