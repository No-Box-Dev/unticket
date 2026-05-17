// Local harness: drive the real matchPRToFeatures() against a handful of
// fixture features and PRs, using an in-memory D1 stub. Hits the real Zhipu
// API — needs ZHIPU_API_KEY in the environment.
//
// Usage:
//   ZHIPU_API_KEY=$(security find-generic-password -a "$USER" -s ZHIPU_API_KEY -w) \
//     node scripts/matcher-harness.mjs
//
// What it prints: per-PR matched features with the LLM's quoted evidence,
// plus a summary (match rate, multi-match count, false-positive guesses for
// the deliberately-unrelated PRs).

import { matchPRToFeatures } from "../functions/lib/feature-matcher.js";

const ORG_ID = 1;
const REPO = "test-repo";
const NOW = Date.now();
const ISO = (msAgo) => new Date(NOW - msAgo).toISOString().replace("T", " ").replace("Z", "").slice(0, 19);

// Created 30 days ago → all features predate every PR below.
const FEATURE_CREATED_AT = ISO(30 * 24 * 3600 * 1000);
// All PRs created 1 hour ago, well after feature creation.
const PR_CREATED_AT = new Date(NOW - 3600 * 1000).toISOString();

const FEATURES = [
  {
    number: 42,
    title: "Login button",
    body: "Add a login button to the homepage hero. Should route to /login.",
    labels: ["auth", "ui"],
    assignees: ["alice"],
  },
  {
    number: 43,
    title: "Settings refresh",
    body: "Redesign the settings page with new sections and a sticky sidebar.",
    labels: ["settings", "ui"],
    assignees: ["bob"],
  },
  {
    number: 44,
    title: "CSV export",
    body: "Export the activity table to CSV from the toolbar action.",
    labels: ["export"],
    assignees: ["carol"],
  },
  {
    number: 45,
    title: "Dark mode",
    body: "Theme toggle in user menu. Persist preference in localStorage.",
    labels: ["theme", "ui"],
    assignees: ["dave"],
  },
  {
    number: 46,
    title: "Email digest",
    body: "Daily summary email of activity, opt-in from notification settings.",
    labels: ["notifications", "email"],
    assignees: ["alice", "bob"],
  },
  {
    number: 47,
    title: "Slack notifications",
    body: "Post deploy notifications to a configured Slack channel via webhook.",
    labels: ["notifications", "integrations"],
    assignees: ["carol"],
  },
  {
    number: 48,
    title: "PDF reports",
    body: "Generate downloadable PDF reports of weekly metrics from the dashboard.",
    labels: ["reports", "export"],
    assignees: ["dave"],
  },
  {
    number: 49,
    title: "Two-factor auth",
    body: "Add TOTP-based 2FA enrollment under account security settings.",
    labels: ["auth", "security"],
    assignees: ["alice"],
  },
  {
    number: 50,
    title: "Mobile responsive nav",
    body: "Collapse the top nav into a hamburger menu under 640px.",
    labels: ["mobile", "ui"],
    assignees: ["bob"],
  },
  {
    number: 51,
    title: "Search shortcut",
    body: "Global search with CMD+K shortcut; surface issues/PRs/features.",
    labels: ["ui"],
    assignees: ["dave"],
  },
];

function featureRow(f) {
  return {
    number: f.number,
    title: f.title,
    body: f.body,
    labels_json: JSON.stringify(f.labels.map((name) => ({ name }))),
    assignees_json: JSON.stringify(f.assignees.map((login) => ({ login }))),
    created_at: FEATURE_CREATED_AT,
  };
}

const FEATURE_ROWS = FEATURES.map(featureRow);

// PR fixtures: a mix of scenarios. The "expected" field is for the summary —
// what we'd hope to see. The LLM is free to disagree.
const PRS = [
  // 1-8: explicit #N references (the easy ones)
  { number: 100, title: "Add login button", branch: "feat/login-button", author: "alice", body: "Closes #42. Adds a sign-in button to the hero.", expected: [42] },
  { number: 101, title: "Settings page redesign", branch: "feat/settings-refresh", author: "bob", body: "Fixes #43 — new sidebar and section layout.", expected: [43] },
  { number: 102, title: "CSV export from toolbar", branch: "feat/44-csv-export", author: "carol", body: "Implements feature #44.", expected: [44] },
  { number: 103, title: "Dark mode toggle", branch: "feat/dark-mode", author: "dave", body: "Resolves unticket#45.", expected: [45] },
  { number: 104, title: "2FA enrollment", branch: "feat/2fa", author: "alice", body: "Closes #49.", expected: [49] },
  { number: 105, title: "Hamburger nav under 640px", branch: "feat/mobile-nav", author: "bob", body: "Fixes #50.", expected: [50] },
  { number: 106, title: "CMD+K search palette", branch: "feat/cmdk-search", author: "dave", body: "Implements #51.", expected: [51] },
  { number: 107, title: "Slack webhook for deploys", branch: "feat/slack-deploy", author: "carol", body: "Closes #47.", expected: [47] },

  // 9-14: branch encodes feature number, no body reference
  { number: 108, title: "Improve login flow", branch: "feat/42-login", author: "alice", body: "Polish the hero button styling.", expected: [42] },
  { number: 109, title: "Settings improvements", branch: "feat/43-settings", author: "bob", body: "Tighten spacing on sidebar.", expected: [43] },
  { number: 110, title: "Export polish", branch: "feat/44-csv", author: "carol", body: "Add trailing newline to CSV output.", expected: [44] },
  { number: 111, title: "Theme tweaks", branch: "feat/45-dark", author: "dave", body: "Persist preference across reload.", expected: [45] },
  { number: 112, title: "Digest tweaks", branch: "feat/46-digest", author: "alice", body: "Send at 9am local.", expected: [46] },
  { number: 113, title: "PDF generator", branch: "feat/48-pdf", author: "dave", body: "Use puppeteer to render the report.", expected: [48] },

  // 15-20: distinctive keyword overlap, no #N
  { number: 114, title: "Hero sign-in button", branch: "feat/hero-signin", author: "alice", body: "Adds a Login button to /home hero section.", expected: [42] },
  { number: 115, title: "TOTP enrollment flow", branch: "feat/totp", author: "alice", body: "Account security: TOTP 2FA enrollment.", expected: [49] },
  { number: 116, title: "Hamburger menu on mobile", branch: "feat/mobile-hamburger", author: "bob", body: "Mobile responsive nav collapses to hamburger.", expected: [50] },
  { number: 117, title: "CMD+K palette", branch: "feat/search-palette", author: "dave", body: "Global search with CMD+K shortcut.", expected: [51] },
  { number: 118, title: "Slack webhook integration", branch: "feat/slack-integration", author: "carol", body: "Post to Slack channel via webhook.", expected: [47] },
  { number: 119, title: "PDF export of weekly metrics", branch: "feat/pdf-report", author: "dave", body: "Generate weekly metric report as PDF.", expected: [48] },

  // 21-24: multi-feature PRs
  { number: 120, title: "Auth refresh: login + 2FA", branch: "feat/auth-refresh", author: "alice", body: "Closes #42 and #49 — login button + TOTP 2FA enrollment.", expected: [42, 49] },
  { number: 121, title: "Notifications: email + Slack", branch: "feat/notifications", author: "carol", body: "Implements #46 (email digest) and #47 (Slack webhook).", expected: [46, 47] },
  { number: 122, title: "Exports: CSV and PDF", branch: "feat/exports", author: "dave", body: "Closes #44 and #48 — CSV table export and PDF reports.", expected: [44, 48] },
  { number: 123, title: "UI: mobile nav + dark mode", branch: "feat/ui-pass", author: "bob", body: "Fixes #50 and #45.", expected: [50, 45] },

  // 25-30: author-overlap, weak topical evidence (should NOT match — author alone is not enough)
  { number: 124, title: "Add useDebounce hook", branch: "chore/debounce", author: "alice", body: "Generic utility hook.", expected: [] },
  { number: 125, title: "Update lockfile", branch: "chore/lockfile", author: "bob", body: "Bump dependencies.", expected: [] },
  { number: 126, title: "Refactor table component", branch: "refactor/table", author: "carol", body: "Extract row renderer.", expected: [] },
  { number: 127, title: "Fix typo in README", branch: "docs/readme", author: "dave", body: "s/teh/the/.", expected: [] },
  { number: 128, title: "Test cleanup", branch: "test/cleanup", author: "alice", body: "Remove unused fixtures.", expected: [] },
  { number: 129, title: "Settings spacing tweak", branch: "ui/spacing", author: "bob", body: "Bump padding.", expected: [] },

  // 31-36: completely unrelated infrastructure / chores
  { number: 130, title: "Bump vite to 5.4", branch: "deps/vite", author: "carol", body: "Patch release.", expected: [] },
  { number: 131, title: "Add CI cache step", branch: "ci/cache", author: "dave", body: "Speed up workflow.", expected: [] },
  { number: 132, title: "Migrate to Cloudflare Pages", branch: "infra/pages", author: "alice", body: "Move from Workers to Pages.", expected: [] },
  { number: 133, title: "Add eslint rule", branch: "chore/eslint", author: "bob", body: "Disallow console.log.", expected: [] },
  { number: 134, title: "Rotate API tokens", branch: "ops/rotate", author: "carol", body: "Quarterly rotation.", expected: [] },
  { number: 135, title: "Fix flaky test", branch: "test/flaky", author: "dave", body: "Add retry.", expected: [] },

  // 37-42: tricky — same generic words as features, but unrelated scope
  { number: 136, title: "Auth refactor", branch: "refactor/auth", author: "alice", body: "Pull auth helpers into shared module. No new functionality.", expected: [] },
  { number: 137, title: "Settings cleanup", branch: "chore/settings", author: "bob", body: "Remove dead settings config keys.", expected: [] },
  { number: 138, title: "Update notification copy", branch: "ui/notif-copy", author: "carol", body: "Edit notification banner text.", expected: [] },
  { number: 139, title: "Export helper rename", branch: "refactor/export", author: "dave", body: "Rename internal helper from xlsExport to exportXls.", expected: [] },
  { number: 140, title: "Search test scaffolding", branch: "test/search", author: "alice", body: "Add search component test setup.", expected: [] },
  { number: 141, title: "Mobile media query fix", branch: "fix/mobile-mq", author: "bob", body: "Correct breakpoint for tablet.", expected: [] },

  // 43-46: borderline — scope overlap without explicit reference
  { number: 142, title: "Login: redirect after auth", branch: "feat/login-redirect", author: "alice", body: "After clicking the login button on the homepage, redirect to /dashboard.", expected: [42] },
  { number: 143, title: "Sticky sidebar on settings page", branch: "feat/settings-sidebar", author: "bob", body: "Make the settings page sidebar sticky on scroll.", expected: [43] },
  { number: 144, title: "TOTP backup codes", branch: "feat/totp-backup", author: "alice", body: "Generate backup codes during TOTP 2FA enrollment.", expected: [49] },
  { number: 145, title: "Slack channel config UI", branch: "feat/slack-config", author: "carol", body: "Form to set the Slack channel for deploy notifications.", expected: [47] },

  // 47-50: noise to round to 50
  { number: 146, title: "Add Sentry DSN", branch: "infra/sentry", author: "dave", body: "Wire error tracking.", expected: [] },
  { number: 147, title: "Improve loading skeleton", branch: "ui/skeleton", author: "alice", body: "Better placeholder.", expected: [] },
  { number: 148, title: "Drop legacy webhook endpoint", branch: "chore/legacy-webhook", author: "carol", body: "Removed last caller.", expected: [] },
  { number: 149, title: "Add health check route", branch: "infra/health", author: "bob", body: "GET /health returns 200.", expected: [] },
];

function makeStub() {
  const captured = {
    matchAttempts: [], // {result, featureNumber, rawResponse}
    links: [], // {featureNumber}
  };

  function prepare(sql) {
    // Mirror D1: bind() returns a fresh bound-statement object so calling
    // stmt.bind(a) and stmt.bind(b) on the same prepared statement doesn't
    // overwrite each other inside a batch.
    function bound(binds) {
      return {
        _sql: sql,
        _binds: binds,
        bind(...args) { return bound(args); },
        async first() {
          if (sql.includes("FROM pr_match_attempts")) return null;
          if (sql.includes("FROM pr_feature_links")) return null;
          return null;
        },
        async all() {
          if (sql.includes("FROM features")) return { results: FEATURE_ROWS };
          return { results: [] };
        },
        async run() {
          if (sql.includes("pr_match_attempts")) {
            captured.matchAttempts.push({
              sql,
              binds: [...binds],
              result: binds[3],
              featureNumber: binds[4],
              rawResponse: binds[5],
            });
          }
          return { meta: { changes: 1 } };
        },
      };
    }
    return bound([]);
  }

  return {
    captured,
    db: {
      prepare,
      async batch(stmts) {
        for (const s of stmts) {
          if (s._sql.includes("pr_feature_links")) {
            captured.links.push({
              featureNumber: s._binds[1],
              prRepo: s._binds[2],
              prNumber: s._binds[3],
            });
          } else if (s._sql.includes("pr_match_attempts")) {
            captured.matchAttempts.push({
              sql: s._sql,
              binds: [...s._binds],
              result: s._binds[3],
              featureNumber: s._binds[4],
              rawResponse: s._binds[5],
            });
          }
        }
        return stmts.map(() => ({ meta: { changes: 1 } }));
      },
    },
  };
}

function fmtPRSummary(pr) {
  return `PR #${pr.number} "${pr.title}" (${pr.author}, branch=${pr.branch})`;
}

function setEq(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

async function run() {
  if (!process.env.ZHIPU_API_KEY) {
    console.error("ZHIPU_API_KEY not set. Run with:");
    console.error('  ZHIPU_API_KEY=$(security find-generic-password -a "$USER" -s ZHIPU_API_KEY -w) node scripts/matcher-harness.mjs');
    process.exit(2);
  }

  const concurrency = Number(process.env.CONCURRENCY ?? 4);
  const results = new Array(PRS.length);
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= PRS.length) return;
      const pr = PRS[i];
      const stub = makeStub();
      const env = { ZHIPU_API_KEY: process.env.ZHIPU_API_KEY, DB: stub.db };
      const prPayload = {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        head: { ref: pr.branch },
        base: { ref: "main" },
        user: { login: pr.author },
        labels: [],
        created_at: PR_CREATED_AT,
      };
      const start = Date.now();
      let err = null;
      try {
        await matchPRToFeatures(env, ORG_ID, REPO, prPayload);
      } catch (e) {
        err = e?.message ?? String(e);
      }
      const elapsed = Date.now() - start;
      const matched = stub.captured.links.map((l) => l.featureNumber);
      const attempt = stub.captured.matchAttempts[0] ?? null;
      results[i] = { pr, matched, attempt, err, elapsed };
      process.stderr.write(`[${i + 1}/${PRS.length}] PR #${pr.number} → matched ${matched.length} (${elapsed}ms)\n`);
    }
  });
  await Promise.all(workers);

  // Pretty-print results
  console.log("\n=== Per-PR results ===\n");
  for (const r of results) {
    const { pr, matched, attempt, err } = r;
    console.log(fmtPRSummary(pr));
    console.log(`  expected: [${pr.expected.join(", ") || "—"}]`);
    console.log(`  matched : [${matched.join(", ") || "—"}]   ${r.elapsed}ms`);
    if (err) console.log(`  ERROR   : ${err}`);
    if (attempt?.rawResponse) {
      // Pretty-print the LLM response when we can parse it
      try {
        const parsed = JSON.parse(attempt.rawResponse);
        if (parsed?.matches?.length) {
          for (const m of parsed.matches) {
            console.log(`    #${m.feature_number}: ${(m.evidence ?? []).join(" | ")}`);
          }
        } else {
          console.log("    (no matches in LLM response)");
        }
      } catch {
        console.log(`    raw: ${attempt.rawResponse.slice(0, 200)}`);
      }
    }
    console.log("");
  }

  // Summary
  let tp = 0, fp = 0, fn = 0, exactMatch = 0;
  let withMatch = 0, multiMatch = 0;
  for (const r of results) {
    const got = new Set(r.matched);
    const want = new Set(r.pr.expected);
    if (got.size > 0) withMatch++;
    if (got.size > 1) multiMatch++;
    if (setEq(r.matched, r.pr.expected)) exactMatch++;
    for (const n of got) {
      if (want.has(n)) tp++; else fp++;
    }
    for (const n of want) {
      if (!got.has(n)) fn++;
    }
  }
  console.log("=== Summary ===");
  console.log(`Total PRs        : ${results.length}`);
  console.log(`Exact (set match): ${exactMatch}/${results.length}`);
  console.log(`Matched anything : ${withMatch}`);
  console.log(`Multi-matches    : ${multiMatch}`);
  console.log(`True positives   : ${tp}`);
  console.log(`False positives  : ${fp}`);
  console.log(`False negatives  : ${fn}`);
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  console.log(`Precision        : ${precision.toFixed(2)}`);
  console.log(`Recall           : ${recall.toFixed(2)}`);
}

run().catch((e) => {
  console.error("Harness crashed:", e);
  process.exit(1);
});
