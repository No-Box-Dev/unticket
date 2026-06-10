import { getCtx, jsonResponse, errorResponse } from "../lib/db";
import { resolveSpecsConfig, listSpecs } from "../lib/specs";

// GET /api/specs — list top-level spec folders under the configured root.
// Returns { configured, repo, rootPath, specs: [{ name }] }.
export async function onRequestGet(context) {
  const { orgId } = getCtx(context);
  if (!orgId) return errorResponse("Missing org context", 400);

  const cfg = await resolveSpecsConfig(context.env.DB, orgId);
  if (!cfg.configured) {
    return jsonResponse({ configured: false, specs: [] });
  }
  try {
    const specs = await listSpecs(context.env, cfg.repo, cfg.rootPath);
    return jsonResponse({
      configured: true,
      repo: cfg.repo,
      rootPath: cfg.rootPath,
      specs: specs.map((s) => ({ name: s.name })),
    });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err), 502);
  }
}
