import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../llm.js", () => ({
  complete: vi.fn(),
}));

import { matchPRToFeatures } from "../feature-matcher.js";
import { complete } from "../llm.js";

// D1 stub. Dispatches reads by SQL substring:
//   prior       → row for pr_match_attempts SELECT
//   existing    → row for pr_feature_links SELECT
//   features    → rows for the features SELECT
//   shouldThrow → SQL substring → Error message, simulates D1 failures
function makeDb({ prior = null, existing = null, features = [], shouldThrow = {} } = {}) {
  const calls = { firsts: [], runs: [], batches: [] };

  function maybeThrow(sql) {
    for (const [needle, msg] of Object.entries(shouldThrow)) {
      if (sql.includes(needle)) throw new Error(msg);
    }
  }

  function prepare(sql) {
    return {
      _sql: sql,
      _binds: [],
      bind(...binds) { this._binds = binds; return this; },
      async first() {
        calls.firsts.push({ sql, binds: this._binds });
        maybeThrow(sql);
        if (sql.includes("FROM pr_match_attempts")) return prior;
        if (sql.includes("FROM pr_feature_links")) return existing;
        return null;
      },
      async all() {
        if (sql.includes("FROM features")) return { results: features };
        return { results: [] };
      },
      async run() {
        calls.runs.push({ sql, binds: this._binds });
        maybeThrow(sql);
        return { meta: { changes: 1 } };
      },
    };
  }

  return {
    prepare,
    async batch(stmts) {
      calls.batches.push(stmts.map((s) => ({ sql: s._sql, binds: s._binds })));
      return stmts.map(() => ({ meta: { changes: 1 } }));
    },
    _calls: calls,
  };
}

const ENV = (db) => ({ DB: db, ZHIPU_API_KEY: "z-key" });

const PR = {
  number: 100,
  title: "Add login button",
  body: "Closes the auth flow.",
  created_at: "2026-05-15T10:00:00Z",
  head: { ref: "feat/42-add-login" },
  base: { ref: "main" },
};

const FEATURE_ROWS = [
  { number: 42, title: "Login button", body: "Adds a login button to the navbar.", labels_json: "[]", assignees_json: "[]", created_at: "2026-05-10T00:00:00Z" },
  { number: 43, title: "Settings refresh", body: "Reworks the settings page.", labels_json: "[]", assignees_json: "[]", created_at: "2026-05-12T00:00:00Z" },
];

function singleMatch(num, evidence = ["PR title contains: \"login button\""]) {
  return JSON.stringify({ matches: [{ feature_number: num, evidence }] });
}

beforeEach(() => complete.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("matchPRToFeatures — preconditions", () => {
  it("returns null when ZHIPU_API_KEY is missing", async () => {
    const db = makeDb();
    expect(await matchPRToFeatures({ DB: db }, 1, "api", PR)).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it("returns null when pr.number is missing", async () => {
    const db = makeDb();
    expect(await matchPRToFeatures(ENV(db), 1, "api", {})).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("matchPRToFeatures — TTL skip", () => {
  it("returns null when a recent attempt is cached", async () => {
    const recent = new Date(Date.now() - 24 * 3600 * 1000).toISOString().replace("T", " ").replace(/\..*$/, "");
    const db = makeDb({ prior: { attempted_at: recent } });
    expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it("proceeds when the attempt is older than 168h", async () => {
    const old = new Date(Date.now() - 200 * 3600 * 1000).toISOString().replace("T", " ").replace(/\..*$/, "");
    const db = makeDb({
      prior: { attempted_at: old },
      features: FEATURE_ROWS,
    });
    complete.mockResolvedValue(singleMatch(42));
    const result = await matchPRToFeatures(ENV(db), 1, "api", PR);
    expect(result).toBe(42);
    expect(complete).toHaveBeenCalled();
  });

  it("treats a corrupt attempted_at as no cache (proceeds)", async () => {
    const db = makeDb({
      prior: { attempted_at: "not a date" },
      features: FEATURE_ROWS,
    });
    complete.mockResolvedValue(JSON.stringify({ matches: [] }));
    await matchPRToFeatures(ENV(db), 1, "api", PR);
    expect(complete).toHaveBeenCalled();
  });

  it("survives D1 failure on the attempt-lookup query (treats as no cache)", async () => {
    const db = makeDb({
      shouldThrow: { "FROM pr_match_attempts": "D1 boom" },
      features: FEATURE_ROWS,
    });
    complete.mockResolvedValue(singleMatch(42));
    const result = await matchPRToFeatures(ENV(db), 1, "api", PR);
    expect(result).toBe(42);
  });
});

describe("matchPRToFeatures — existing-link skip", () => {
  it("returns null when the PR already has any link", async () => {
    const db = makeDb({ existing: { 1: 1 } });
    expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("matchPRToFeatures — date anchor (PR vs feature creation)", () => {
  it("rejects PRs with no created_at and records the reason", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    const noDatePR = { ...PR, created_at: null };
    expect(await matchPRToFeatures(ENV(db), 1, "api", noDatePR)).toBeNull();
    expect(complete).not.toHaveBeenCalled();
    expect(db._calls.runs.some((r) => r.binds.includes("no_pr_created_at"))).toBe(true);
  });

  it("filters out features that didn't exist when the PR was opened", async () => {
    const future = { number: 99, title: "Future feature", body: "", labels_json: "[]", assignees_json: "[]", created_at: "2026-06-01T00:00:00Z" };
    const db = makeDb({ features: [future, ...FEATURE_ROWS] });
    complete.mockResolvedValue(singleMatch(42));
    await matchPRToFeatures(ENV(db), 1, "api", PR);
    const userMessage = complete.mock.calls[0][1].user;
    expect(userMessage).not.toContain("#99");
    expect(userMessage).toContain("#42");
  });

  it("returns null + records 'no_features' when no candidates survive filtering", async () => {
    const futureOnly = { number: 99, title: "x", body: "", labels_json: "[]", assignees_json: "[]", created_at: "2026-06-01T00:00:00Z" };
    const db = makeDb({ features: [futureOnly] });
    expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBeNull();
    expect(complete).not.toHaveBeenCalled();
    expect(db._calls.runs.some((r) => r.binds.includes("no_features"))).toBe(true);
  });

  it("tolerates malformed labels_json (treats as no labels, keeps the feature)", async () => {
    const malformed = {
      number: 60,
      title: "Bad labels",
      body: "",
      labels_json: "not json",
      assignees_json: "[]",
      created_at: "2026-05-01T00:00:00Z",
    };
    const db = makeDb({ features: [malformed] });
    complete.mockResolvedValue(singleMatch(60));
    const result = await matchPRToFeatures(ENV(db), 1, "api", PR);
    expect(result).toBe(60);
  });
});

describe("matchPRToFeatures — LLM response parsing", () => {
  it("returns the matched feature when the LLM picks a valid candidate", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    complete.mockResolvedValue(singleMatch(43));
    expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBe(43);
  });

  it("returns null + records 'no_match' when the LLM returns an empty matches array", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    complete.mockResolvedValue(JSON.stringify({ matches: [] }));
    expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBeNull();
    expect(db._calls.runs.some((r) => r.binds.includes("no_match"))).toBe(true);
  });

  it("rejects hallucinated feature numbers (LLM picks one not in candidates)", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    complete.mockResolvedValue(singleMatch(9999));
    expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBeNull();
    expect(db._calls.runs.some((r) => r.binds.includes("no_match"))).toBe(true);
  });

  it("rejects non-integer / zero / negative feature numbers in matches", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    for (const bad of [1.5, 0, -3]) {
      complete.mockResolvedValueOnce(JSON.stringify({ matches: [{ feature_number: bad, evidence: [] }] }));
      expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBeNull();
    }
  });

  it("rejects malformed / empty / non-string LLM responses", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    for (const bad of ["not json at all", "", "   ", null, undefined]) {
      complete.mockResolvedValueOnce(bad);
      expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBeNull();
    }
  });

  it("rejects responses without a matches array", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    complete.mockResolvedValue(JSON.stringify({ feature_number: 42 }));
    expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBeNull();
  });

  it("dedupes repeat feature_numbers in the LLM response", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    complete.mockResolvedValue(JSON.stringify({
      matches: [
        { feature_number: 42, evidence: ["a"] },
        { feature_number: 42, evidence: ["b"] },
        { feature_number: 43, evidence: ["c"] },
      ],
    }));
    await matchPRToFeatures(ENV(db), 1, "api", PR);
    const linkInserts = db._calls.batches[0].filter((s) => s.sql.includes("INSERT INTO pr_feature_links"));
    expect(linkInserts).toHaveLength(2);
  });

  it("tolerates GLM-style ```json ... ``` code fences around the response", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    const fenced = "```json\n" + JSON.stringify({ matches: [{ feature_number: 42, evidence: ["e"] }] }) + "\n```";
    complete.mockResolvedValue(fenced);
    expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBe(42);
  });

  it("tolerates bare ``` ... ``` fences (no language tag)", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    const fenced = "```\n" + JSON.stringify({ matches: [{ feature_number: 43, evidence: ["e"] }] }) + "\n```";
    complete.mockResolvedValue(fenced);
    expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBe(43);
  });

  it("tolerates a prose preamble before the JSON object", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    const prose = 'Here is the answer:\n' + JSON.stringify({ matches: [{ feature_number: 42, evidence: ["e"] }] });
    complete.mockResolvedValue(prose);
    expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBe(42);
  });

  it("caps the number of returned matches at 5", async () => {
    const manyFeatures = Array.from({ length: 10 }, (_, i) => ({
      number: 100 + i,
      title: `F${i}`,
      body: "",
      labels_json: "[]",
      assignees_json: "[]",
      created_at: "2026-05-01T00:00:00Z",
    }));
    const db = makeDb({ features: manyFeatures });
    complete.mockResolvedValue(JSON.stringify({
      matches: manyFeatures.map((f) => ({ feature_number: f.number, evidence: ["e"] })),
    }));
    await matchPRToFeatures(ENV(db), 1, "api", PR);
    const linkInserts = db._calls.batches[0].filter((s) => s.sql.includes("INSERT INTO pr_feature_links"));
    expect(linkInserts).toHaveLength(5);
  });
});

describe("matchPRToFeatures — multi-match writes", () => {
  it("inserts one pr_feature_links row per match, plus one pr_match_attempts row, in a single batch", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    complete.mockResolvedValue(JSON.stringify({
      matches: [
        { feature_number: 42, evidence: ["t1"] },
        { feature_number: 43, evidence: ["t2"] },
      ],
    }));
    await matchPRToFeatures(ENV(db), 1, "api", PR);
    expect(db._calls.batches).toHaveLength(1);
    const batch = db._calls.batches[0];
    const linkInserts = batch.filter((s) => s.sql.includes("INSERT INTO pr_feature_links"));
    const attemptInserts = batch.filter((s) => s.sql.includes("INSERT INTO pr_match_attempts"));
    expect(linkInserts).toHaveLength(2);
    expect(attemptInserts).toHaveLength(1);
    expect(linkInserts[0].sql).toContain("'llm'");
    // First match's feature_number is persisted in the attempts row for back-compat.
    expect(attemptInserts[0].binds[3]).toBe(42);
  });

  it("returns the first matched feature number", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    complete.mockResolvedValue(JSON.stringify({
      matches: [
        { feature_number: 43, evidence: ["t"] },
        { feature_number: 42, evidence: ["t"] },
      ],
    }));
    expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBe(43);
  });
});

describe("matchPRToFeatures — raw response persistence", () => {
  it("stores the LLM's raw response on a successful match", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    const raw = singleMatch(42, ["evidence"]);
    complete.mockResolvedValue(raw);
    await matchPRToFeatures(ENV(db), 1, "api", PR);
    const attemptInsert = db._calls.batches[0].find((s) => s.sql.includes("INSERT INTO pr_match_attempts"));
    expect(attemptInsert.binds[4]).toBe(raw);
  });

  it("stores the LLM's raw response on a no_match outcome", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    const raw = JSON.stringify({ matches: [] });
    complete.mockResolvedValue(raw);
    await matchPRToFeatures(ENV(db), 1, "api", PR);
    const attemptRun = db._calls.runs.find((r) => r.binds.includes("no_match"));
    expect(attemptRun).toBeDefined();
    expect(attemptRun.binds).toContain(raw);
  });

  it("truncates raw_response at 2000 chars", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    const longRaw = "x".repeat(5000);
    complete.mockResolvedValue(longRaw);
    await matchPRToFeatures(ENV(db), 1, "api", PR);
    const attemptRun = db._calls.runs.find((r) => r.binds.includes("no_match"));
    expect(attemptRun.binds.some((b) => typeof b === "string" && b.length === 2000)).toBe(true);
  });
});

describe("matchPRToFeatures — user message shape", () => {
  it("includes the branch, base branch, author, labels, and a truncated body", async () => {
    const longBody = "x".repeat(2000);
    const db = makeDb({ features: FEATURE_ROWS });
    complete.mockResolvedValue(singleMatch(42));
    await matchPRToFeatures(ENV(db), 1, "api", {
      ...PR,
      body: longBody,
      labels: [{ name: "auth" }, { name: "ui" }],
      user: { login: "alice" },
    });
    const userMessage = complete.mock.calls[0][1].user;
    expect(userMessage).toContain("feat/42-add-login");
    expect(userMessage).toContain("Base branch: main");
    expect(userMessage).toContain("Author: alice");
    expect(userMessage).toContain("Labels: auth, ui");
    // Body capped at 1200 chars
    const bodyMatch = userMessage.match(/Body:\n(x+)/);
    expect(bodyMatch?.[1].length).toBe(1200);
  });

  it("falls back to '(empty)' when the PR body is missing", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    complete.mockResolvedValue(singleMatch(42));
    await matchPRToFeatures(ENV(db), 1, "api", { ...PR, body: null });
    expect(complete.mock.calls[0][1].user).toContain("(empty)");
  });

  it("flags feature assignees matching the PR author and includes feature bodies", async () => {
    const featureWithAuthor = {
      number: 42,
      title: "Login button",
      body: "Adds a login button to the navbar.",
      labels_json: "[]",
      assignees_json: JSON.stringify([{ login: "alice" }, { login: "bob" }]),
      created_at: "2026-05-10T00:00:00Z",
    };
    const otherFeature = {
      number: 43,
      title: "Settings refresh",
      body: "Reworks the settings page.",
      labels_json: "[]",
      assignees_json: JSON.stringify([{ login: "carol" }]),
      created_at: "2026-05-12T00:00:00Z",
    };
    const db = makeDb({ features: [featureWithAuthor, otherFeature] });
    complete.mockResolvedValue(singleMatch(42));
    await matchPRToFeatures(ENV(db), 1, "api", { ...PR, user: { login: "alice" } });
    const userMessage = complete.mock.calls[0][1].user;
    expect(userMessage).toContain("alice (PR author)");
    expect(userMessage).toContain("bob");
    expect(userMessage).toContain("carol");
    expect(userMessage).not.toContain("bob (PR author)");
    expect(userMessage).not.toContain("carol (PR author)");
    expect(userMessage).toContain("login button");
    expect(userMessage).toContain("settings page");
  });

  it("strips the unticket:metadata block from feature bodies", async () => {
    const feature = {
      number: 42,
      title: "Login button",
      body: "Real plan content\n\n<!-- unticket:metadata\n" +
        JSON.stringify({ linkedPRs: [{ repo: "api", number: 7 }] }) +
        "\n-->",
      labels_json: "[]",
      assignees_json: "[]",
      created_at: "2026-05-10T00:00:00Z",
    };
    const db = makeDb({ features: [feature] });
    complete.mockResolvedValue(singleMatch(42));
    await matchPRToFeatures(ENV(db), 1, "api", PR);
    const userMessage = complete.mock.calls[0][1].user;
    expect(userMessage).toContain("Real plan content");
    expect(userMessage).not.toContain("unticket:metadata");
    expect(userMessage).not.toContain("linkedPRs");
  });

  it("truncates feature bodies at 400 chars", async () => {
    const feature = {
      number: 42,
      title: "Long plan",
      body: "y".repeat(2000),
      labels_json: "[]",
      assignees_json: "[]",
      created_at: "2026-05-10T00:00:00Z",
    };
    const db = makeDb({ features: [feature] });
    complete.mockResolvedValue(singleMatch(42));
    await matchPRToFeatures(ENV(db), 1, "api", PR);
    const userMessage = complete.mock.calls[0][1].user;
    const featureBody = userMessage.match(/Body: (y+)/g)?.pop();
    expect(featureBody).toBeDefined();
    expect(featureBody.replace(/^Body: /, "").length).toBe(400);
  });

  it("includes distinctive feature labels but drops housekeeping ones", async () => {
    const feature = {
      number: 42,
      title: "Login button",
      body: "",
      labels_json: JSON.stringify([
        { name: "feature" },
        { name: "unticket" },
        { name: "status:staging" },
        { name: "auth" },
        { name: "ui" },
      ]),
      assignees_json: "[]",
      created_at: "2026-05-10T00:00:00Z",
    };
    const db = makeDb({ features: [feature] });
    complete.mockResolvedValue(singleMatch(42));
    await matchPRToFeatures(ENV(db), 1, "api", PR);
    const userMessage = complete.mock.calls[0][1].user;
    expect(userMessage).toMatch(/Labels: auth, ui|Labels: ui, auth/);
    expect(userMessage).not.toContain("status:staging");
  });

  it("omits the Author line + marker when pr.user is missing", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    complete.mockResolvedValue(singleMatch(42));
    await matchPRToFeatures(ENV(db), 1, "api", PR);
    const userMessage = complete.mock.calls[0][1].user;
    expect(userMessage).not.toContain("Author:");
    expect(userMessage).not.toContain("(PR author)");
  });

  it("tolerates malformed assignees_json (no assignee section emitted)", async () => {
    const bad = {
      number: 42,
      title: "Login button",
      body: "",
      labels_json: "[]",
      assignees_json: "not json",
      created_at: "2026-05-10T00:00:00Z",
    };
    const db = makeDb({ features: [bad] });
    complete.mockResolvedValue(singleMatch(42));
    await matchPRToFeatures(ENV(db), 1, "api", { ...PR, user: { login: "alice" } });
    const userMessage = complete.mock.calls[0][1].user;
    expect(userMessage).toContain("#42");
    expect(userMessage).not.toContain("Assignees:");
  });
});

describe("matchPRToFeatures — candidate cap", () => {
  it("caps candidates at 30, keeping the most recent features", async () => {
    const features = Array.from({ length: 40 }, (_, i) => ({
      number: 1000 + i,
      title: `Feature ${i}`,
      body: "",
      labels_json: "[]",
      assignees_json: "[]",
      // Returning ORDER BY created_at DESC, simulate that order in the stub:
      created_at: new Date(2026, 0, 1 + (40 - i)).toISOString(),
    }));
    const db = makeDb({ features });
    complete.mockResolvedValue(JSON.stringify({ matches: [] }));
    await matchPRToFeatures(ENV(db), 1, "api", { ...PR, created_at: "2027-01-01T00:00:00Z" });
    const userMessage = complete.mock.calls[0][1].user;
    const featureCount = (userMessage.match(/^- #/gm) ?? []).length;
    expect(featureCount).toBe(30);
    // Last (oldest) features should be excluded.
    expect(userMessage).toContain("#1000");
    expect(userMessage).not.toContain("#1039");
  });
});
