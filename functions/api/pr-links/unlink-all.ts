// POST /api/pr-links/unlink-all  body: { confirm: "UNLINK_ALL" }
//
// Wipes EVERY PR↔feature link for the org:
//   1. Clears `linkedPRs` from each affected feature issue body on GitHub
//   2. Truncates `pr_feature_links` for the org
//   3. Truncates `pr_match_attempts` for the org so the next backfill re-asks
//      the LLM about every PR rather than reading cached "no match" rows.
//
// Sized for an admin "reset" action — runs synchronously so the UI can show
// the final count when the modal closes. GitHub writes run with a small
// concurrency limit to keep the total wall time bounded without spraying
// the API.

import { z } from "zod";
import { getCtx, jsonResponse, errorResponse } from "../../lib/db";
import {
  parseFeatureMetadata,
  serializeFeatureMetadata,
  readFeatureIssue,
  updateFeatureBody,
} from "../../lib/feature-metadata";
import { validate } from "../../lib/validate";

interface Env {
  DB: D1Database;
}

interface Ctx {
  env: Env;
  data: { orgId: number; orgLogin: string; token: string; isAdmin: boolean };
  request: Request;
}

const CONCURRENCY = 5;

// Body schema — requires the exact confirmation token. The literal both
// guards against accidental wipes and reproduces the prior 400 message.
const UnlinkAllBody = z.object({
  confirm: z.literal("UNLINK_ALL", { message: "Missing or invalid confirmation token" }),
});

export async function onRequestPost(context: Ctx): Promise<Response> {
  const { orgId, orgLogin, token, isAdmin } = getCtx(context) as {
    orgId: number;
    orgLogin: string;
    token: string;
    isAdmin: boolean;
  };
  if (!orgId || !orgLogin || !token) {
    return errorResponse("Missing org context", 400);
  }
  if (!isAdmin) return errorResponse("Admin required", 403);

  let rawBody: unknown;
  try {
    rawBody = await context.request.json();
  } catch {
    rawBody = {};
  }

  const parsed = validate(UnlinkAllBody, rawBody);
  if (!parsed.ok) return parsed.response;

  const db = context.env.DB;

  const linkRows = await db
    .prepare("SELECT DISTINCT feature_number FROM pr_feature_links WHERE org_id = ?")
    .bind(orgId)
    .all();
  const featureNumbers = (linkRows.results ?? []).map((r) => Number(r.feature_number));

  const errors = [];
  let featuresCleared = 0;
  for (let i = 0; i < featureNumbers.length; i += CONCURRENCY) {
    const batch = featureNumbers.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((n) => clearFeatureLinks(db, token, orgLogin, orgId, n)),
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") {
        featuresCleared++;
      } else {
        errors.push(`feature #${batch[j]}: ${r.reason?.message ?? r.reason}`);
      }
    }
  }

  // Wipe D1 unconditionally — a partial GitHub failure shouldn't leave stale
  // D1 rows pointing at links the user explicitly asked to remove. The next
  // backfill rebuilds whatever is still valid.
  const wipe = await db.batch([
    db.prepare("DELETE FROM pr_feature_links WHERE org_id = ?").bind(orgId),
    db.prepare("DELETE FROM pr_match_attempts WHERE org_id = ?").bind(orgId),
  ]);
  const linksDeleted = wipe[0]?.meta?.changes ?? 0;
  const attemptsCleared = wipe[1]?.meta?.changes ?? 0;

  return jsonResponse({
    ok: true,
    featuresAffected: featureNumbers.length,
    featuresCleared,
    linksDeleted,
    attemptsCleared,
    errors,
  });
}

async function clearFeatureLinks(db: D1Database, token: string, orgLogin: string, orgId: number, featureNumber: number) {
  const issue = await readFeatureIssue(token, orgLogin, featureNumber);
  const { content, metadata } = parseFeatureMetadata(issue.body ?? "");
  if (!metadata.linkedPRs || metadata.linkedPRs.length === 0) return;
  metadata.linkedPRs = [];
  const newBody = serializeFeatureMetadata(content, metadata);
  await updateFeatureBody(token, orgLogin, featureNumber, newBody);
  await db
    .prepare("UPDATE features SET body = ? WHERE org_id = ? AND number = ?")
    .bind(newBody, orgId, featureNumber)
    .run();
}
