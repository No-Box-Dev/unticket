// Server-side feature metadata helpers (mirrors frontend github-features.ts logic)

const METADATA_RE = /\n?<!-- gitpulse:metadata\n([\s\S]*?)\n-->\s*$/;

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
  } catch {
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
    (metadata.linkedPRs && metadata.linkedPRs.length > 0);
  if (!hasData) return content;
  return `${content}\n\n<!-- gitpulse:metadata\n${JSON.stringify(metadata)}\n-->`;
}

/**
 * Read a feature issue from the gitpulse repo.
 * Returns the full issue object from GitHub API.
 */
export async function readFeatureIssue(token, orgLogin, number) {
  const res = await fetch(
    `https://api.github.com/repos/${orgLogin}/gitpulse/issues/${number}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "GitPulse",
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
 * Update a feature issue body in the gitpulse repo.
 */
export async function updateFeatureBody(token, orgLogin, number, body) {
  const res = await fetch(
    `https://api.github.com/repos/${orgLogin}/gitpulse/issues/${number}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "GitPulse",
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

/**
 * Extract a feature number from a branch name.
 * Matches: feat/42-description, feature/42, fix/42-bug, chore/42, refactor/42, 42-some-branch
 * NOTE: Duplicated from src/lib/github.ts — keep both in sync when changing branch patterns.
 */
export function parseFeatureFromBranch(ref) {
  if (!ref) return null;
  const match = ref.match(/^(?:feat|feature|fix|chore|refactor)\/(\d+)(?:-|$)/);
  if (match) return Number(match[1]);
  const plain = ref.match(/^(\d+)-/);
  if (plain) return Number(plain[1]);
  return null;
}

/**
 * Extract feature numbers from a PR body/description.
 * Matches:
 *   - Part of org/gitpulse#42
 *   - Part of gitpulse#42
 *   - Feature #42 / Feature: #42
 *   - gitpulse#42 (standalone reference)
 * Returns deduplicated array of feature numbers.
 */
export function parseFeaturesFromBody(body) {
  if (!body) return [];
  const nums = new Set();
  // "Part of org/gitpulse#N" or "Part of gitpulse#N"
  for (const m of body.matchAll(/part\s+of\s+(?:[\w-]+\/)?gitpulse#(\d+)/gi)) {
    nums.add(Number(m[1]));
  }
  // "Feature #N" or "Feature: #N"
  for (const m of body.matchAll(/feature[:\s]+#(\d+)/gi)) {
    nums.add(Number(m[1]));
  }
  // Standalone "gitpulse#N"
  for (const m of body.matchAll(/\bgitpulse#(\d+)/gi)) {
    nums.add(Number(m[1]));
  }
  return [...nums];
}
