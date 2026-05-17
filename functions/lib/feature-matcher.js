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

const SYSTEM_PROMPT = `You decide whether a pull request belongs to ONE specific open feature.

The bar for matching is HIGH. Return a feature number ONLY when the PR text contains explicit, concrete evidence that it implements that feature. Acceptable evidence:
- The PR title, branch name, or body explicitly references the feature number (e.g. "#42", "feature 42", "closes #42", "fixes #42").
- The PR title, branch name, or body contains DISTINCTIVE keywords from the feature's title or labels — words specific enough that they would not appear in unrelated PRs.
- The PR body explicitly describes implementing this feature's scope.

An additional supporting signal (NOT sufficient on its own):
- The PR author is one of the feature's assignees. This pushes a borderline call toward a match, but the PR text must still show topical relevance. Author-assignee overlap alone, with no scope evidence, is NOT enough — people work on multiple features.

What is NOT evidence:
- Generic shared words like "fix", "update", "refactor", "settings", "auth", "ui", "api", "test", "cleanup".
- Loose topical overlap or "feels related". If you are pattern-matching on vibes, return null.
- A PR that touches the same area of the codebase as a feature, without explicitly addressing it.

If two or more candidate features could plausibly fit, return null. If you are not at least 90% confident, return null. When in doubt, return null — a missed match is cheap, a wrong match is expensive.

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
      `SELECT number, title, labels_json, assignees_json, created_at
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
    .map((f) => ({
      number: f.number,
      title: f.title,
      labels: distinctiveLabels(f.labels_json),
      assignees: assigneeLogins(f.assignees_json),
    }));
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

// Labels useful for matching — drop housekeeping labels that every feature
// carries (unticket, feature) and the status:* lifecycle labels, which say
// nothing about scope.
function distinctiveLabels(json) {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v
      .map((l) => l?.name)
      .filter((n) => typeof n === "string" && n)
      .filter((n) => n !== "unticket" && n !== "feature" && !n.startsWith("status:"));
  } catch {
    return [];
  }
}

function assigneeLogins(json) {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v.map((a) => a?.login).filter((l) => typeof l === "string" && l);
  } catch {
    return [];
  }
}

function buildUserMessage(repo, pr, features) {
  const author = pr.user?.login ?? null;
  const featuresText = features
    .map((f) => {
      const parts = [];
      if (f.labels.length) parts.push(`labels: ${f.labels.join(", ")}`);
      if (f.assignees.length) {
        const marked = f.assignees.map((a) => (author && a === author ? `${a} (PR author)` : a));
        parts.push(`assignees: ${marked.join(", ")}`);
      }
      const meta = parts.length ? ` [${parts.join("; ")}]` : "";
      return `- #${f.number}: ${f.title}${meta}`;
    })
    .join("\n");
  const branch = pr.head?.ref ?? "unknown";
  const body = (pr.body ?? "").slice(0, 800);
  const authorLine = author ? `PR author: ${author}\n` : "";
  return `Open features:\n${featuresText}\n\nPull request:\n${authorLine}PR #${pr.number} in ${repo} on branch "${branch}": ${pr.title}\nDescription: ${body || "(empty)"}`;
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
