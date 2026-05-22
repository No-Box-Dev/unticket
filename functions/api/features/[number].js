// /api/features/:number — single-feature mutations against the unticket
// repo. PATCH edits title/status/owners/plan; DELETE closes the issue and
// strips the unticket/feature/status labels. Both paths mirror the GitHub
// response back into the D1 features table so /api/features (GET) stays
// authoritative without waiting for the webhook to round-trip.

import { getCtx, jsonResponse, errorResponse } from "../../lib/db";
import { parseFeatureMetadata } from "../../lib/feature-metadata";
import {
  buildFeatureLabels,
  buildIssueBody,
  extractStatusFromLabels,
  ghIssueToFeature,
  patchFeatureIssue,
  readFeatureRow,
  readLinkedPRs,
  upsertFeatureRow,
  UNTICKET_LABEL,
  FEATURE_LABEL,
  VALID_STATUSES,
} from "../../lib/feature-issues";

function parseFeatureNumber(context) {
  const raw = context.params?.number;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

// PATCH /api/features/:number
// Body: { title?, status?, owners?: string[], plan?: string }
// Any omitted field is left unchanged on GitHub (the current value is sent
// back so a partial update doesn't blank out a field we didn't touch).
export async function onRequestPatch(context) {
  const { orgId, orgLogin, token } = getCtx(context);
  if (!orgLogin || !token) return errorResponse("Missing org context", 400);

  const number = parseFeatureNumber(context);
  if (!number) return errorResponse("Invalid feature number", 400);

  let payload;
  try { payload = await context.request.json(); } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const row = await readFeatureRow(context.env.DB, orgId, number);
  if (!row) return errorResponse("Feature not found", 404);

  // Compose desired state from request + current D1 row.
  const currentLabels = JSON.parse(row.labels_json || "[]");
  const currentStatus = extractStatusFromLabels(currentLabels);
  const currentAssignees = JSON.parse(row.assignees_json || "[]");
  const { content: currentPlan, metadata: currentMetadata } = parseFeatureMetadata(row.body ?? "");

  const title = typeof payload?.title === "string" && payload.title.trim()
    ? payload.title.trim()
    : row.title;

  let status = currentStatus;
  if (payload?.status !== undefined) {
    if (!VALID_STATUSES.has(payload.status)) {
      return errorResponse(`Invalid status: ${payload.status}`, 422);
    }
    status = payload.status;
  }

  let owners = currentAssignees.map((a) => a.login);
  if (Array.isArray(payload?.owners)) {
    owners = payload.owners.filter(
      (o) => typeof o === "string" && /^[a-zA-Z0-9-]+$/.test(o),
    );
  }

  const plan = typeof payload?.plan === "string" ? payload.plan : currentPlan;

  // Status history: append on transition only. Re-saves with the same status
  // don't duplicate entries.
  const statusHistory = [...(currentMetadata.statusHistory ?? [])];
  if (status !== currentStatus) {
    statusHistory.push({ status, timestamp: new Date().toISOString() });
  }

  const body = buildIssueBody(plan, {
    statusHistory,
    linkedPRs: currentMetadata.linkedPRs,
  });

  const ghIssue = await patchFeatureIssue(token, orgLogin, number, {
    title,
    body,
    labels: buildFeatureLabels(status),
    assignees: owners,
  });

  await upsertFeatureRow(context.env.DB, orgId, ghIssue);
  const linkedPRs = await readLinkedPRs(context.env.DB, orgId, number);
  return jsonResponse(ghIssueToFeature(ghIssue, linkedPRs));
}

// DELETE /api/features/:number — close the issue on GitHub, strip
// unticket/feature/status labels so it disappears from the board, and mark
// D1 closed.
export async function onRequestDelete(context) {
  const { orgId, orgLogin, token } = getCtx(context);
  if (!orgLogin || !token) return errorResponse("Missing org context", 400);

  const number = parseFeatureNumber(context);
  if (!number) return errorResponse("Invalid feature number", 400);

  const row = await readFeatureRow(context.env.DB, orgId, number);
  if (!row) return errorResponse("Feature not found", 404);

  // Drop unticket-owned labels but keep any user-applied ones.
  const currentLabels = JSON.parse(row.labels_json || "[]");
  const keepLabels = currentLabels
    .map((l) => l.name)
    .filter(
      (name) =>
        name !== UNTICKET_LABEL &&
        name !== FEATURE_LABEL &&
        !name.startsWith("status:"),
    );

  const ghIssue = await patchFeatureIssue(token, orgLogin, number, {
    labels: keepLabels,
    state: "closed",
  });

  await upsertFeatureRow(context.env.DB, orgId, ghIssue);
  return jsonResponse({ ok: true });
}
