// Shared reload budget for stale-chunk recovery. The global vite:preloadError
// listener and the ErrorBoundary both call tryAutoReload() — sessionStorage
// keeps a counter so they can't reload-loop past the budget between them.

const RELOAD_KEY = "preloadErrorReloads";
const MAX_AUTO_RELOADS = 3;
const MIN_RELOAD_INTERVAL_MS = 5000;

const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /ChunkLoadError/i,
];

export function isChunkLoadError(error: Error | null | undefined): boolean {
  if (!error) return false;
  return CHUNK_ERROR_PATTERNS.some((re) => re.test(error.message));
}

// Returns true if a reload was scheduled, false if the per-session budget
// is exhausted (so the caller can fall back to a user-visible message).
export function tryAutoReload(): boolean {
  let entry: { count: number; last: number };
  try {
    entry = JSON.parse(sessionStorage.getItem(RELOAD_KEY) ?? '{"count":0,"last":0}');
  } catch {
    entry = { count: 0, last: 0 };
  }
  const now = Date.now();
  if (entry.count >= MAX_AUTO_RELOADS) return false;
  if (now - entry.last < MIN_RELOAD_INTERVAL_MS) return false;
  sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ count: entry.count + 1, last: now }));
  window.location.reload();
  return true;
}
