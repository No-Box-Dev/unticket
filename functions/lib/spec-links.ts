// Shared SpecLink shape + sanitizer.
//
// Used by Features (per-feature URL list stored in the issue body's metadata
// block) AND by the Specs feature (each spec has a URL list stored as
// links_json). The two callers share the same rules: http(s) only, drops
// empty/malformed rows, trims optional label, caps the list length.
//
// Spec links surface as clickable <a href> in the UI, so this is a real
// injection boundary: reject anything that isn't a well-formed http(s) URL.

export interface SpecLink {
  url: string;
  label?: string;
  /** At most one link in a list can be primary. Server enforces the
   * "at most one" invariant so bad clients can't corrupt the picker. */
  primary?: boolean;
}

const MAX_SPEC_LINKS = 50;
const MAX_LABEL_LEN = 200;

export function sanitizeSpecLinks(input: unknown): SpecLink[] {
  if (!Array.isArray(input)) return [];
  const out: SpecLink[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const raw = (item as { url?: unknown }).url;
    const rawUrl = typeof raw === "string" ? raw.trim() : "";
    if (!rawUrl) continue;
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    const rawLabel = (item as { label?: unknown }).label;
    const label = typeof rawLabel === "string" ? rawLabel.trim().slice(0, MAX_LABEL_LEN) : "";
    const primary = (item as { primary?: unknown }).primary === true;
    const entry: SpecLink = label ? { url: rawUrl, label } : { url: rawUrl };
    if (primary) entry.primary = true;
    out.push(entry);
    if (out.length >= MAX_SPEC_LINKS) break;
  }
  // At-most-one-primary invariant: keep the first true, drop the flag on
  // the rest. Cheaper here than a per-mutation check on the client.
  let seenPrimary = false;
  for (const l of out) {
    if (l.primary) {
      if (seenPrimary) delete l.primary;
      else seenPrimary = true;
    }
  }
  return out;
}
