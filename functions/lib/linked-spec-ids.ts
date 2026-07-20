// Shared helper for the `linkedSpecIds` field on Feature metadata.
// A Feature can point at any number of manual Specs (see functions/api/specs).
// Ids are stored as a plain array of ints inside the Feature issue body's
// JSON metadata block — no join table, no FK — and the sanitizer here is
// what turns a raw client payload into a trustworthy id list.

const MAX_LINKED_SPECS = 50;

/**
 * Filter to positive-integer ids, dedupe, cap the list length. Does NOT verify
 * the ids belong to this org — call `filterExistingSpecIds` for that.
 */
export function sanitizeLinkedSpecIds(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const raw of input) {
    const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
    if (!Number.isInteger(n) || n <= 0) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= MAX_LINKED_SPECS) break;
  }
  return out;
}

/**
 * Look up which of these spec ids actually exist for this org and return
 * only those. Called after `sanitizeLinkedSpecIds` on any write that
 * accepts a caller-supplied list, so a Feature can never reference a spec
 * from another org (or a since-deleted one). Preserves caller order.
 *
 * Reads active + archived rows both — archiving a spec should NOT
 * silently break its inbound links from Features.
 */
export async function filterExistingSpecIds(
  db: D1Database,
  orgId: number,
  ids: number[],
): Promise<number[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT id FROM specs WHERE org_id = ? AND id IN (${placeholders})`)
    .bind(orgId, ...ids)
    .all<{ id: number }>();
  const allowed = new Set((results ?? []).map((r) => r.id));
  return ids.filter((id) => allowed.has(id));
}
