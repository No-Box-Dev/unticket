// Shared branch-name → feature-number parser. Imported from server code
// (functions/) directly and re-exported from src/lib/github.ts for the
// client bundle so the regex only lives in one place.

const PREFIXED = /^(?:feat|feature|fix|chore|refactor)\/(\d+)(?:-|$)/;
const PLAIN = /^(\d+)-/;

export function parseFeatureFromBranch(ref) {
  if (!ref) return null;
  const match = ref.match(PREFIXED);
  if (match) return Number(match[1]);
  const plain = ref.match(PLAIN);
  if (plain) return Number(plain[1]);
  return null;
}
