// D1 query helpers

export function getCtx(context) {
  return context.data;
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

export async function getSyncState(db, orgId, resource) {
  const row = await db
    .prepare("SELECT last_synced, etag FROM sync_state WHERE org_id = ? AND resource = ?")
    .bind(orgId, resource)
    .first();
  if (!row) return null;
  return { lastSynced: row.last_synced, etag: row.etag };
}

export async function setSyncState(db, orgId, resource, etag) {
  await db
    .prepare(
      `INSERT INTO sync_state (org_id, resource, last_synced, etag)
       VALUES (?, ?, datetime('now'), ?)
       ON CONFLICT(org_id, resource) DO UPDATE SET
         last_synced = datetime('now'),
         etag = excluded.etag`
    )
    .bind(orgId, resource, etag ?? null)
    .run();
}
