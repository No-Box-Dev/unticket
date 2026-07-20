// Server-side feature metadata helpers (mirrors frontend github-features.ts logic)

const METADATA_RE = /\n?<!-- unticket:metadata\n([\s\S]*?)\n-->\s*$/;

/**
 * Parse metadata from a feature issue body.
 * Returns { content, metadata } where content is the body without the metadata block.
 */
export function parseFeatureMetadata(body) {
  if (!body) return { content: "", metadata: {} };
  const match = body.match(METADATA_RE);
  if (!match) return { content: body, metadata: {} };
  try {
    const metadata = JSON.parse(match[1]);
    return { content: body.slice(0, match.index), metadata };
  } catch (e) {
    console.warn("[unticket] Corrupt feature metadata block, ignoring:", e);
    return { content: body, metadata: {} };
  }
}

/**
 * Serialize metadata back into the issue body.
 * Appends the metadata as an HTML comment block.
 */
export function serializeFeatureMetadata(content, metadata) {
  const hasData =
    (metadata.statusHistory && metadata.statusHistory.length > 0) ||
    (metadata.linkedPRs && metadata.linkedPRs.length > 0) ||
    (metadata.specLinks && metadata.specLinks.length > 0);
  if (!hasData) return content;
  return `${content}\n\n<!-- unticket:metadata\n${JSON.stringify(metadata)}\n-->`;
}

// sanitizeSpecLinks moved to ./spec-links.ts — shared with the manual Specs
// feature. Import it directly from there.

/**
 * Read a feature issue from the unticket repo.
 * Returns the full issue object from GitHub API.
 */
export async function readFeatureIssue(token, orgLogin, number) {
  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(orgLogin)}/unticket/issues/${encodeURIComponent(number)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Unticket",
        Accept: "application/vnd.github+json",
      },
    }
  );
  if (!res.ok) {
    throw new Error(`Failed to read feature issue #${number}: ${res.status}`);
  }
  return res.json();
}

/**
 * Update a feature issue body in the unticket repo.
 */
export async function updateFeatureBody(token, orgLogin, number, body) {
  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(orgLogin)}/unticket/issues/${encodeURIComponent(number)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Unticket",
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    }
  );
  if (!res.ok) {
    throw new Error(`Failed to update feature issue #${number}: ${res.status}`);
  }
  return res.json();
}

