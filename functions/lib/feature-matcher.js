// LLM-powered PR-to-feature matcher. One call per PR, against the current
// open-feature list (excluding the backlog). Supports MULTI-feature matches.
//
// One prompt, full context. The prompt enumerates the matching rules in
// plain English so the LLM has the same rubric a code pipeline would. The
// raw response is persisted so prompt iteration is data-driven, not blind.
//
// Idempotency: every call records into pr_match_attempts so a re-sync
// doesn't re-ask the LLM about the same PR. Webhook is the primary
// trigger; sync / cron backfill anything the webhook missed.

import { complete } from "./llm.js";
import { parseFeatureMetadata } from "./feature-metadata.js";

const MAX_TOKENS = 800;
const ATTEMPT_TTL_HOURS = 168;
const PR_BODY_LIMIT = 1200;
const FEATURE_BODY_LIMIT = 400;
const CANDIDATE_CAP = 30;
const RAW_RESPONSE_LIMIT = 2000;
const MAX_RETURNED_MATCHES = 5;

const SYSTEM_PROMPT = `You match a pull request to zero or more open features it implements.

Match a feature if you have at least one CONCRETE piece of evidence:
- The PR body, title, or branch name explicitly references the feature number (e.g. "#42", "closes #42", "unticket#42", "feat/42-foo").
- The PR title or branch contains DISTINCTIVE keywords from the feature's title, body, or labels — words specific enough that they would not appear in unrelated PRs.
- The PR body explicitly describes implementing this feature's scope.
- The PR author is one of the feature's assignees AND the PR title / branch / body shows topical overlap with the feature.

NOT evidence:
- Generic shared words: "fix", "update", "refactor", "settings", "auth", "ui", "api", "test", "cleanup".
- Topical similarity or "feels related" — if you are pattern-matching on vibes, do not match.
- Touching the same area of the codebase as a feature, without explicitly addressing it.
- Author being an assignee, ALONE, without scope evidence — people work on multiple features.

A PR can implement MULTIPLE features. Return all that satisfy the rules above. Each match must have its own evidence.

Each evidence string must QUOTE the source text verbatim, e.g. 'PR body contains: "fixes #42"' or 'feature title contains: "login button"'. Quoted-substring evidence is harder to fabricate than paraphrased evidence.

Reply with ONLY valid JSON in this exact format:
{"matches": [
  {"feature_number": 42, "evidence": ["...", "..."]},
  {"feature_number": 43, "evidence": ["..."]}
]}

Empty matches array if nothing qualifies:
{"matches": []}

Length budget: at most 5 matches, at most 3 evidence items per match, at most 80 characters per evidence string.`;

export async function matchPRToFeatures(env, orgId, repo, pr) {
  if (!env?.ZHIPU_API_KEY) return null;
  if (!pr?.number) return null;

  const db = env.DB;

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

  // Manual / metadata-sync links are more authoritative than an LLM guess.
  const existing = await db
    .prepare(
      "SELECT 1 FROM pr_feature_links WHERE org_id = ? AND pr_repo = ? AND pr_number = ? LIMIT 1",
    )
    .bind(orgId, repo, pr.number)
    .first()
    .catch(() => null);
  if (existing) return null;

  // A PR can only belong to a feature that existed when the PR was opened.
  // Without a PR creation timestamp we refuse to guess.
  const prCreatedMs = pr.created_at ? Date.parse(pr.created_at) : NaN;
  if (!Number.isFinite(prCreatedMs)) {
    await recordAttempt(db, orgId, repo, pr.number, "no_pr_created_at", null, null);
    return null;
  }

  const features = await fetchCandidateFeatures(db, orgId, prCreatedMs);
  if (features.length === 0) {
    await recordAttempt(db, orgId, repo, pr.number, "no_features", null, null);
    return null;
  }

  const text = await complete(env.ZHIPU_API_KEY, {
    system: SYSTEM_PROMPT,
    user: buildUserMessage(repo, pr, features),
    maxTokens: MAX_TOKENS,
    tag: "feature-matcher",
  });

  const matches = parseMatches(text, features);
  const rawTrunc = typeof text === "string" ? text.slice(0, RAW_RESPONSE_LIMIT) : null;

  if (matches.length === 0) {
    await recordAttempt(db, orgId, repo, pr.number, "no_match", null, rawTrunc);
    return null;
  }

  const linkStmt = db.prepare(
    `INSERT INTO pr_feature_links (org_id, feature_number, pr_repo, pr_number, source)
     VALUES (?, ?, ?, ?, 'llm')
     ON CONFLICT(org_id, feature_number, pr_repo, pr_number) DO NOTHING`,
  );
  const attemptStmt = db.prepare(
    `INSERT INTO pr_match_attempts (org_id, pr_repo, pr_number, attempted_at, result, feature_number, raw_response)
     VALUES (?, ?, ?, datetime('now'), 'match', ?, ?)
     ON CONFLICT(org_id, pr_repo, pr_number) DO UPDATE SET
       attempted_at = excluded.attempted_at,
       result = excluded.result,
       feature_number = excluded.feature_number,
       raw_response = excluded.raw_response`,
  );

  await db.batch([
    ...matches.map((m) => linkStmt.bind(orgId, m.featureNumber, repo, pr.number)),
    attemptStmt.bind(orgId, repo, pr.number, matches[0].featureNumber, rawTrunc),
  ]);
  return matches[0].featureNumber;
}

async function fetchCandidateFeatures(db, orgId, prCreatedMs) {
  const rows = await db
    .prepare(
      `SELECT number, title, body, labels_json, assignees_json, created_at
       FROM features
       WHERE org_id = ? AND state = 'open'
       ORDER BY created_at DESC`,
    )
    .bind(orgId)
    .all();
  const filtered = (rows.results ?? [])
    .filter((f) => !hasLabel(f.labels_json, "status:future"))
    .filter((f) => {
      const featureCreatedMs = f.created_at ? Date.parse(f.created_at) : NaN;
      if (!Number.isFinite(featureCreatedMs)) return false;
      return featureCreatedMs <= prCreatedMs;
    })
    .slice(0, CANDIDATE_CAP);
  return filtered.map((f) => ({
    number: f.number,
    title: f.title,
    body: stripMetadata(f.body),
    labels: distinctiveLabels(f.labels_json),
    assignees: assigneeLogins(f.assignees_json),
  }));
}

function stripMetadata(body) {
  if (!body) return "";
  try {
    return parseFeatureMetadata(body).content ?? "";
  } catch {
    return body;
  }
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

function prLabelNames(labels) {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((l) => (typeof l === "string" ? l : l?.name))
    .filter((n) => typeof n === "string" && n);
}

function buildUserMessage(repo, pr, features) {
  const author = pr.user?.login ?? null;
  const branch = pr.head?.ref ?? "unknown";
  const base = pr.base?.ref ?? null;
  const labels = prLabelNames(pr.labels);
  const body = (pr.body ?? "").slice(0, PR_BODY_LIMIT);

  const prLines = [`PR #${pr.number} in ${repo} on branch "${branch}":`];
  prLines.push(`Title: ${pr.title ?? ""}`);
  if (author) prLines.push(`Author: ${author}`);
  if (base) prLines.push(`Base branch: ${base}`);
  if (labels.length) prLines.push(`Labels: ${labels.join(", ")}`);
  prLines.push("Body:");
  prLines.push(body || "(empty)");

  const featureBlocks = features.map((f) => {
    const lines = [`- #${f.number}: ${f.title}`];
    if (f.labels.length) lines.push(`  Labels: ${f.labels.join(", ")}`);
    if (f.assignees.length) {
      const marked = f.assignees.map((a) => (author && a === author ? `${a} (PR author)` : a));
      lines.push(`  Assignees: ${marked.join(", ")}`);
    }
    const trimmedBody = f.body.slice(0, FEATURE_BODY_LIMIT).trim();
    if (trimmedBody) lines.push(`  Body: ${trimmedBody}`);
    return lines.join("\n");
  });

  return `${prLines.join("\n")}\n\nOpen features:\n${featureBlocks.join("\n\n")}`;
}

function parseMatches(text, candidates) {
  if (typeof text !== "string") return [];
  const trimmed = text.trim();
  if (!trimmed) return [];
  // GLM-5 often wraps JSON in ```json ... ``` fences despite the prompt
  // saying "reply with ONLY valid JSON". Extract the outer object instead
  // of trusting bare JSON.parse().
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  let parsed;
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = Array.isArray(parsed?.matches) ? parsed.matches : null;
  if (!list) return [];

  const candidateNumbers = new Set(candidates.map((c) => c.number));
  const seen = new Set();
  const out = [];
  for (const m of list) {
    const num = m?.feature_number;
    if (!Number.isInteger(num) || num <= 0) continue;
    if (!candidateNumbers.has(num)) continue;
    if (seen.has(num)) continue;
    seen.add(num);
    const evidence = Array.isArray(m?.evidence)
      ? m.evidence.filter((e) => typeof e === "string" && e.trim())
      : [];
    out.push({ featureNumber: num, evidence });
    if (out.length >= MAX_RETURNED_MATCHES) break;
  }
  return out;
}

async function recordAttempt(db, orgId, repo, prNumber, result, featureNumber, rawResponse) {
  try {
    await db
      .prepare(
        `INSERT INTO pr_match_attempts (org_id, pr_repo, pr_number, attempted_at, result, feature_number, raw_response)
         VALUES (?, ?, ?, datetime('now'), ?, ?, ?)
         ON CONFLICT(org_id, pr_repo, pr_number) DO UPDATE SET
           attempted_at = excluded.attempted_at,
           result = excluded.result,
           feature_number = excluded.feature_number,
           raw_response = excluded.raw_response`,
      )
      .bind(orgId, repo, prNumber, result, featureNumber, rawResponse)
      .run();
  } catch (err) {
    console.warn(`[feature-matcher] recordAttempt failed: ${err?.message ?? err}`);
  }
}
