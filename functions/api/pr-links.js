import { getCtx, jsonResponse, errorResponse } from "../lib/db";
import {
  parseFeatureMetadata,
  serializeFeatureMetadata,
  readFeatureIssue,
  updateFeatureBody,
} from "../lib/feature-metadata";

// GET /api/pr-links?feature=42 — query D1 cache for linked PRs
export async function onRequestGet(context) {
  const { orgId } = getCtx(context);
  const url = new URL(context.request.url);
  const feature = url.searchParams.get("feature");

  if (!feature) return errorResponse("feature query param required", 400);
  // Number() is strict — rejects "123abc" / "1.5"; parseInt would accept them.
  const featureNumber = Number(feature);
  if (!Number.isInteger(featureNumber) || featureNumber <= 0) {
    return errorResponse("feature must be a positive integer", 400);
  }

  const rows = await context.env.DB
    .prepare(
      "SELECT pr_repo, pr_number, source, created_at FROM pr_feature_links WHERE org_id = ? AND feature_number = ? ORDER BY created_at ASC"
    )
    .bind(orgId, featureNumber)
    .all();

  return jsonResponse(rows.results);
}

// POST /api/pr-links — link a PR to a feature (D1 first, then GitHub metadata)
export async function onRequestPost(context) {
  const { orgId, token, orgLogin } = getCtx(context);
  let body;
  try { body = await context.request.json(); } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  const { feature_number, pr_repo, pr_number } = body ?? {};

  if (!Number.isInteger(feature_number) || feature_number <= 0) {
    return errorResponse("feature_number must be a positive integer", 400);
  }
  if (!Number.isInteger(pr_number) || pr_number <= 0) {
    return errorResponse("pr_number must be a positive integer", 400);
  }
  if (typeof pr_repo !== "string" || !/^[\w.-]+$/.test(pr_repo)) {
    return errorResponse("pr_repo must be a valid repo name", 400);
  }

  // 1. Upsert D1 cache first (atomic, no race condition)
  await context.env.DB
    .prepare(
      `INSERT INTO pr_feature_links (org_id, feature_number, pr_repo, pr_number, source)
       VALUES (?, ?, ?, ?, 'manual')
       ON CONFLICT(org_id, feature_number, pr_repo, pr_number) DO NOTHING`
    )
    .bind(orgId, feature_number, pr_repo, pr_number)
    .run();

  // 2. Update GitHub issue metadata in the background (read-modify-write)
  // This avoids blocking the response and reduces race window
  context.waitUntil((async () => {
    try {
      const issue = await readFeatureIssue(token, orgLogin, feature_number);
      const { content, metadata } = parseFeatureMetadata(issue.body ?? "");

      const linkedPRs = metadata.linkedPRs ?? [];
      const exists = linkedPRs.some(
        (l) => l.repo === pr_repo && l.number === pr_number
      );
      if (!exists) {
        linkedPRs.push({ repo: pr_repo, number: pr_number });
        metadata.linkedPRs = linkedPRs;
        const newBody = serializeFeatureMetadata(content, metadata);
        await updateFeatureBody(token, orgLogin, feature_number, newBody);
        await context.env.DB
          .prepare("UPDATE features SET body = ? WHERE org_id = ? AND number = ?")
          .bind(newBody, orgId, feature_number)
          .run();
      }
    } catch (e) {
      console.error(`[gitpulse] Failed to update GitHub metadata for feature #${feature_number}:`, e);
    }
  })());

  return jsonResponse({ ok: true });
}

// DELETE /api/pr-links?feature=42&pr_repo=api-backend&pr_number=601 — unlink
export async function onRequestDelete(context) {
  const { orgId, token, orgLogin } = getCtx(context);
  const url = new URL(context.request.url);
  const feature = url.searchParams.get("feature");
  const prRepo = url.searchParams.get("pr_repo");
  const prNumber = url.searchParams.get("pr_number");

  if (!feature || !prRepo || !prNumber) {
    return errorResponse("feature, pr_repo, pr_number required", 400);
  }

  const featureNumber = Number(feature);
  const prNum = Number(prNumber);
  if (!Number.isInteger(featureNumber) || featureNumber <= 0) {
    return errorResponse("feature must be a positive integer", 400);
  }
  if (!Number.isInteger(prNum) || prNum <= 0) {
    return errorResponse("pr_number must be a positive integer", 400);
  }
  if (!/^[\w.-]+$/.test(prRepo)) {
    return errorResponse("pr_repo must be a valid repo name", 400);
  }

  // 1. Read feature issue body from GitHub
  const issue = await readFeatureIssue(token, orgLogin, featureNumber);
  const { content, metadata } = parseFeatureMetadata(issue.body ?? "");

  // 2. Remove from linkedPRs
  const linkedPRs = (metadata.linkedPRs ?? []).filter(
    (l) => !(l.repo === prRepo && l.number === prNum)
  );
  metadata.linkedPRs = linkedPRs;

  // 3. Write back to GitHub
  const newBody = serializeFeatureMetadata(content, metadata);
  await updateFeatureBody(token, orgLogin, featureNumber, newBody);

  // 4. Update features table + remove link atomically
  await context.env.DB.batch([
    context.env.DB.prepare("UPDATE features SET body = ? WHERE org_id = ? AND number = ?")
      .bind(newBody, orgId, featureNumber),
    context.env.DB.prepare(
      "DELETE FROM pr_feature_links WHERE org_id = ? AND feature_number = ? AND pr_repo = ? AND pr_number = ?"
    )
      .bind(orgId, featureNumber, prRepo, prNum),
  ]);

  return jsonResponse({ ok: true });
}
