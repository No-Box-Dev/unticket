import { getCtx, jsonResponse } from "../lib/db";

// GET /api/bootstrap-status — lightweight poll endpoint for the dashboard
// loading state. Returns whether the install webhook's initial backfill is
// still in flight for this org. Single-row SELECT, no GitHub calls.
//
// `bootstrapping = true` when the org has an installation_id (the App is
// installed) but bootstrapped_at is still NULL. The dashboard polls this
// every few seconds until it flips to false, then refetches its data.
//
// Legacy orgs (PAT-only, no installation_id) are reported as ready so the
// dashboard never gets stuck spinning.
export async function onRequestGet(context) {
  const { orgId } = getCtx(context);
  const row = await context.env.DB.prepare(
    "SELECT installation_id, bootstrapped_at FROM orgs WHERE id = ?"
  ).bind(orgId).first();

  const bootstrapping = !!row?.installation_id && !row?.bootstrapped_at;
  return jsonResponse({ bootstrapping });
}
