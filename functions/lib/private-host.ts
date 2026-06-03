// Shared SSRF guard. Block hostnames that resolve into the worker's local
// network or link-local / metadata ranges. We can't fully defend against DNS
// rebinding from a CF Worker (no pre-resolve API short of `connect()`), but
// blocking literal IPs + common local names kills the easy variants.
//
// Used on BOTH the save path (api/llm-settings.ts, when an admin sets a BYOK
// base URL) AND the runtime path (lib/llm-config.js, every time the narrator
// resolves the endpoint) — a save-time-only check is defeated by an admin
// re-pointing DNS after saving, so the runtime check is the real guard.
export function isPrivateHostname(hostname: string | null | undefined): boolean {
  if (!hostname) return true;
  // URL.hostname wraps IPv6 in brackets ("[::1]"); strip them so the literal
  // comparisons below work against the raw address.
  let lower = hostname.toLowerCase();
  if (lower.startsWith("[") && lower.endsWith("]")) {
    lower = lower.slice(1, -1);
  }

  if (lower === "localhost") return true;
  if (
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal")
  ) {
    return true;
  }

  const v4 = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = v4.slice(1, 3).map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local incl. cloud IMDS
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  if (lower.includes(":")) {
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (lower.startsWith("fe80:")) return true; // link-local
    if (lower.startsWith("::ffff:")) return true; // IPv4-mapped
    return false;
  }

  return false;
}
