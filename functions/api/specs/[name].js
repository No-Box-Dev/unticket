import { getCtx, jsonResponse, errorResponse } from "../../lib/db";
import { resolveSpecsConfig, listSpecFiles, fetchSpecFile, isSafeSegment } from "../../lib/specs";

// GET /api/specs/:name           → { files: [...] }
// GET /api/specs/:name?path=foo.md → { content: "...", contentType, name }
//   Reads a single MD/text file inline so the MarkdownViewer can render it
//   without going through the proxy. Only text-shaped files; binary files
//   should use /specs-content/.
export async function onRequestGet(context) {
  const { orgId } = getCtx(context);
  if (!orgId) return errorResponse("Missing org context", 400);

  const name = context.params.name;
  if (!isSafeSegment(name)) return errorResponse("Invalid spec name", 400);

  const cfg = await resolveSpecsConfig(context.env.DB, orgId);
  if (!cfg.configured) return errorResponse("Specs not configured", 404);

  const url = new URL(context.request.url);
  const pathParam = url.searchParams.get("path");

  try {
    if (pathParam) {
      const file = await fetchSpecFile(context.env, cfg.repo, cfg.rootPath, name, pathParam);
      if (!file) return errorResponse("File not found", 404);
      // Only inline text — anything else uses /specs-content/.
      if (!file.contentType.startsWith("text/") && !file.contentType.startsWith("application/json")) {
        return errorResponse("Use /specs-content/ for binary files", 415);
      }
      const text = new TextDecoder().decode(file.bytes);
      return jsonResponse({
        content: text,
        contentType: file.contentType,
        name: file.name,
        size: file.size,
      });
    }
    const files = await listSpecFiles(context.env, cfg.repo, cfg.rootPath, name);
    return jsonResponse({ name, files });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err), 502);
  }
}
