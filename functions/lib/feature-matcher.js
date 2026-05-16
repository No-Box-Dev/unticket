// LLM-powered PR-to-Feature matcher. One call per PR, against the
// current open feature list (excluding the backlog). Returns at most ONE
// feature — the LLM is instructed to return null when unsure, and we
// reject hallucinated feature numbers that don't exist on the org.
//
// Idempotency: every call records into pr_match_attempts so a re-sync
// doesn't re-ask the LLM about the same PR. Webhook is the primary
// trigger (one PR event → one call); sync/cron backfill anything the
// webhook missed.

import { complete } from "./llm.js";

const MAX_TOKENS = 64;
const ATTEMPT_TTL_HOURS = 168; // one week — keeps a re-sync cheap

const SYSTEM_PROMPT = `You match a pull request to AT MOST ONE open feature it belongs to.

Rules:
- If the PR clearly addresses ONE feature, return that feature's number.
- If the PR addresses zero features, or you are not sure, return null.
- NEVER return more than one feature, even if multiple seem related.

Reply with ONLY valid JSON in this exact format:
{"feature_number": 42}
or
{"feature_number": null}`;

export async function matchPRToFeatures(env, orgId, repo, pr) {
  if (!env?.ZHIPU_API_KEY) return null;
  if (!pr?.number) return null;

  const db = env.DB;

  // Skip if already attempted within the TTL.
  const prior = await db
    .prepare(
      "SELECT attempted_at FROM pr_match_attempts WHERE org_id = ? AND pr_repo = ? AND pr_number = ?",
    )
    .bind(orgId, repo, pr.number)
    .first()
    .catch(() => null);
  if (prior?.attempted_at) {
    const attemptedAt = Date.parse(prior.attempted_at.replace(" ", "T") + "Z");
    if (Number.isFinite(attemptedAt) && Date.now() - attemptedAt < ATTEMPT_TTL_HOURS * 3600 * 1000) {
      return null;
    }
  }

  // Skip if the PR already has any link — manual / branch / body / comment
  // links are more authoritative than an LLM guess.
  const existing = await db
    .prepare(
      "SELECT 1 FROM pr_feature_links WHERE org_id = ? AND pr_repo = ? AND pr_number = ? LIMIT 1",
    )
    .bind(orgId, repo, pr.number)
    .first()
    .catch(() => null);
  if (existing) return null;

  // A PR can only belong to a feature that already existed when the PR
  // was opened. Without a creation timestamp on the PR we have no anchor,
  // so we refuse to guess rather than risk anachronistic links.
  const prCreatedMs = pr.created_at ? Date.parse(pr.created_at) : NaN;
  if (!Number.isFinite(prCreatedMs)) {
    await recordAttempt(db, orgId, repo, pr.number, "no_pr_created_at", null);
    return null;
  }

  const features = await fetchCandidateFeatures(db, orgId, prCreatedMs);
  if (features.length === 0) {
    await recordAttempt(db, orgId, repo, pr.number, "no_features", null);
    return null;
  }

  const text = await complete(env.ZHIPU_API_KEY, {
    system: SYSTEM_PROMPT,
    user: buildUserMessage(repo, pr, features),
    maxTokens: MAX_TOKENS,
    tag: "feature-matcher",
  });

  const featureNumber = parseFeatureNumber(text, features);
  if (featureNumber == null) {
    await recordAttempt(db, orgId, repo, pr.number, "no_match", null);
    return null;
  }

  await db.batch([
    db
      .prepare(
        `INSERT INTO pr_feature_links (org_id, feature_number, pr_repo, pr_number, source)
         VALUES (?, ?, ?, ?, 'llm')
         ON CONFLICT(org_id, feature_number, pr_repo, pr_number) DO NOTHING`,
      )
      .bind(orgId, featureNumber, repo, pr.number),
    db
      .prepare(
        `INSERT INTO pr_match_attempts (org_id, pr_repo, pr_number, attempted_at, result, feature_number)
         VALUES (?, ?, ?, datetime('now'), 'match', ?)
         ON CONFLICT(org_id, pr_repo, pr_number) DO UPDATE SET
           attempted_at = excluded.attempted_at,
           result = excluded.result,
           feature_number = excluded.feature_number`,
      )
      .bind(orgId, repo, pr.number, featureNumber),
  ]);
  return featureNumber;
}

async function fetchCandidateFeatures(db, orgId, prCreatedMs) {
  const rows = await db
    .prepare(
      `SELECT number, title, labels_json, created_at
       FROM features
       WHERE org_id = ? AND state = 'open'
       ORDER BY number ASC`,
    )
    .bind(orgId)
    .all();
  return (rows.results ?? [])
    .filter((f) => !hasLabel(f.labels_json, "status:future"))
    .filter((f) => {
      const featureCreatedMs = f.created_at ? Date.parse(f.created_at) : NaN;
      if (!Number.isFinite(featureCreatedMs)) return false;
      return featureCreatedMs <= prCreatedMs;
    })
    .map((f) => ({ number: f.number, title: f.title }));
}

function hasLabel(json, name) {
  if (!json) return false;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) && v.some((l) => l?.name === name);
  } catch {
    return false;
  }
}

function buildUserMessage(repo, pr, features) {
  const featuresText = features.map((f) => `- #${f.number}: ${f.title}`).join("\n");
  const branch = pr.head?.ref ?? "unknown";
  const body = (pr.body ?? "").slice(0, 800);
  return `Open features:\n${featuresText}\n\nPull request:\nPR #${pr.number} in ${repo} on branch "${branch}": ${pr.title}\nDescription: ${body || "(empty)"}`;
}

function parseFeatureNumber(text, features) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const num = parsed?.feature_number;
  if (num === null) return null;
  if (!Number.isInteger(num) || num <= 0) return null;
  // Reject hallucinated feature numbers.
  if (!features.some((f) => f.number === num)) return null;
  return num;
}

async function recordAttempt(db, orgId, repo, prNumber, result, featureNumber) {
  try {
    await db
      .prepare(
        `INSERT INTO pr_match_attempts (org_id, pr_repo, pr_number, attempted_at, result, feature_number)
         VALUES (?, ?, ?, datetime('now'), ?, ?)
         ON CONFLICT(org_id, pr_repo, pr_number) DO UPDATE SET
           attempted_at = excluded.attempted_at,
           result = excluded.result,
           feature_number = excluded.feature_number`,
      )
      .bind(orgId, repo, prNumber, result, featureNumber)
      .run();
  } catch (err) {
    console.warn(`[feature-matcher] recordAttempt failed: ${err?.message ?? err}`);
  }
}
