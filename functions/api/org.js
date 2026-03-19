import { getCtx, jsonResponse, errorResponse } from "../lib/db";

// GET /api/org — return org-level settings (config repo name)
export async function onRequestGet(context) {
  const { configRepo } = getCtx(context);
  return jsonResponse({ configRepo });
}

// PUT /api/org — update org-level settings
export async function onRequestPut(context) {
  const { orgId } = getCtx(context);
  const body = await context.request.json();
  const configRepo = body.configRepo;

  if (!configRepo || typeof configRepo !== "string" || configRepo.trim().length === 0) {
    return errorResponse("configRepo must be a non-empty string", 400);
  }

  // Validate repo name format (GitHub repo naming rules)
  if (!/^[a-zA-Z0-9._-]+$/.test(configRepo.trim())) {
    return errorResponse("Invalid repo name — use only letters, numbers, dots, hyphens, underscores", 400);
  }

  await context.env.DB
    .prepare("UPDATE orgs SET config_repo = ? WHERE id = ?")
    .bind(configRepo.trim(), orgId)
    .run();

  return jsonResponse({ ok: true, configRepo: configRepo.trim() });
}
