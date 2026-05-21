// Tiny shared helpers for "slow down LLM calls so we don't trip provider
// rate limits". Kept in its own module so tests can `vi.mock` the sleep
// without dragging the rest of llm.js along.

export const NARRATOR_PACING_MS = 1000;

export function sleep(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
