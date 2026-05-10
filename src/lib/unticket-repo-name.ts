// Module-level cache for the configured "unticket" repo name (the repo that
// holds features, todos, plans, snapshots, and people config).
//
// The legacy default is "unticket"; users can override it via Settings →
// Unticket Repo. Lib code that needs the name calls getUnticketRepoName()
// inside its functions (never at module init), so the value reflects the
// most recent settings load.

const FALLBACK = "unticket";
let configured: string | null = null;

export function setUnticketRepoName(name: string | null | undefined): void {
  const trimmed = typeof name === "string" ? name.trim() : "";
  configured = trimmed.length > 0 ? trimmed : null;
}

export function getUnticketRepoName(): string {
  return configured ?? FALLBACK;
}
