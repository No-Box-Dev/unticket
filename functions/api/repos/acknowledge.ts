import { z } from "zod";
import { getCtx, jsonResponse, errorResponse } from "../../lib/db";
import { validate } from "../../lib/validate";

interface Env {
  DB: D1Database;
}

interface Ctx {
  env: Env;
  data: { orgId: number; isAdmin: boolean };
  request: Request;
}

// Max repos per call — well above any plausible single-batch discovery. The
// cap exists so a runaway client (or compromised admin token) can't write a
// 10k-bind statement into D1 in one shot. Repo names follow GitHub's own
// shape, so the regex is the same one in functions/api/assign.ts.
const MAX_NAMES = 500;

// GitHub repo names: max 100 chars, `[A-Za-z0-9._-]`. The length cap protects
// against pathological inputs that would bloat the SQL bind list with junk.
const AcknowledgeBody = z.object({
  names: z
    .array(
      z
        .string()
        .min(1, "Repo name cannot be empty")
        .max(100, "Repo name too long")
        .regex(/^[\w.-]+$/, "Invalid repo name"),
    )
    .min(1, "Provide at least one repo name")
    .max(MAX_NAMES, `Too many repos in one call (max ${MAX_NAMES})`),
});

// POST /api/repos/acknowledge — mark repos as reviewed.
//
// Admin-only. Sets repos.acknowledged_at for each named repo in this org.
// Used by: the NewRepoBanner's "Dismiss all" button, the Settings → Newly
// detected section's per-row Track / Mark draft / Acknowledge all buttons.
// Track / Mark draft additionally toggle the platform-level draft flag via
// the existing POST/DELETE /api/projects/:id/archive endpoints — this
// endpoint only handles the discovery-acknowledgment, kept narrow so the
// client doesn't have to worry about partial failures across two writes.
//
// Idempotent: calling on an already-acknowledged repo is a no-op (the
// timestamp does NOT get overwritten — first-acknowledgment wins).
export async function onRequestPost(context: Ctx): Promise<Response> {
  const { orgId, isAdmin } = getCtx(context) as { orgId: number; isAdmin: boolean };
  if (!orgId) return errorResponse("Missing org context", 400);
  if (!isAdmin) return errorResponse("Admin required", 403);

  let rawBody: unknown;
  try {
    rawBody = await context.request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const parsed = validate(AcknowledgeBody, rawBody);
  if (!parsed.ok) return parsed.response;
  const { names } = parsed.data;

  // Deduplicate so a caller passing the same repo twice doesn't blow up the
  // bind count — and so the result count below matches what was unique.
  const unique = [...new Set(names)];

  // Single statement, bound list. COALESCE protects the original
  // acknowledgment timestamp for repos already acknowledged — re-clicking
  // Dismiss on a stale tab shouldn't slide the timestamp forward.
  const placeholders = unique.map(() => "?").join(", ");
  const result = await context.env.DB
    .prepare(
      `UPDATE repos
          SET acknowledged_at = COALESCE(acknowledged_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        WHERE org_id = ?
          AND name IN (${placeholders})`,
    )
    .bind(orgId, ...unique)
    .run();

  return jsonResponse({
    acknowledged: unique,
    changes: result.meta?.changes ?? 0,
  });
}
