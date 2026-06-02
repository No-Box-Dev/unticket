import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the GitHub I/O so we can assert on issue reads/PATCHes without real HTTP.
vi.mock("../../../lib/feature-metadata.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readFeatureIssue: vi.fn(),
    updateFeatureBody: vi.fn(),
  };
});

import { onRequestPost } from "../unlink-all";
import { readFeatureIssue, updateFeatureBody, serializeFeatureMetadata } from "../../../lib/feature-metadata.js";

// ---- D1 stub mirroring the inactive-repos test shape: keyed off SQL fragments.

function makeDb({ linkedFeatures = [], linkWipeChanges = 0, attemptWipeChanges = 0 } = {}) {
  const calls = { run: [], all: [], batch: [] };
  function prepare(sql) {
    return {
      _sql: sql,
      _binds: [],
      bind(...binds) { this._binds = binds; return this; },
      async all() {
        calls.all.push({ sql, binds: this._binds });
        if (sql.includes("DISTINCT feature_number")) {
          return { results: linkedFeatures.map((n) => ({ feature_number: n })) };
        }
        return { results: [] };
      },
      async run() {
        calls.run.push({ sql, binds: this._binds });
        return { meta: { changes: 0 } };
      },
    };
  }
  return {
    prepare,
    async batch(stmts) {
      calls.batch.push(stmts.map((s) => ({ sql: s._sql, binds: s._binds })));
      // Match the two wipe queries by SQL substring and return the change counts
      // declared by the test. Anything else returns { meta: { changes: 0 } }.
      return stmts.map((s) => {
        if (s._sql.includes("DELETE FROM pr_feature_links")) {
          return { meta: { changes: linkWipeChanges } };
        }
        if (s._sql.includes("DELETE FROM pr_match_attempts")) {
          return { meta: { changes: attemptWipeChanges } };
        }
        return { meta: { changes: 0 } };
      });
    },
    _calls: calls,
  };
}

function makeRequest(body) {
  return new Request("http://test.local/api/pr-links/unlink-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeContext({
  db,
  orgId = 1,
  orgLogin = "acme",
  token = "tok",
  isAdmin = true,
  body = { confirm: "UNLINK_ALL" },
}) {
  return {
    request: makeRequest(body),
    env: { DB: db },
    data: { orgId, orgLogin, token, isAdmin },
  };
}

beforeEach(() => {
  readFeatureIssue.mockReset();
  updateFeatureBody.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/pr-links/unlink-all — guards", () => {
  it("400s when org context is missing", async () => {
    const db = makeDb();
    const ctx = makeContext({ db });
    ctx.data.orgId = null;
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: /Missing org context/ });
  });

  it("400s when the confirmation token is missing", async () => {
    const db = makeDb();
    const res = await onRequestPost(makeContext({ db, body: {} }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: /confirmation token/ });
  });

  it("400s when the confirmation token is wrong", async () => {
    const db = makeDb();
    const res = await onRequestPost(makeContext({ db, body: { confirm: "nope" } }));
    expect(res.status).toBe(400);
  });

  it("400s on invalid JSON body", async () => {
    const db = makeDb();
    const req = new Request("http://test.local/api/pr-links/unlink-all", {
      method: "POST",
      body: "not json",
    });
    const res = await onRequestPost({ request: req, env: { DB: db }, data: { orgId: 1, orgLogin: "acme", token: "tok", isAdmin: true } });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/pr-links/unlink-all — happy path", () => {
  it("returns zero counts when no links exist (and still wipes both tables)", async () => {
    const db = makeDb({ linkedFeatures: [] });
    const res = await onRequestPost(makeContext({ db }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      featuresAffected: 0,
      featuresCleared: 0,
      linksDeleted: 0,
      attemptsCleared: 0,
      errors: [],
    });
    expect(readFeatureIssue).not.toHaveBeenCalled();
    expect(updateFeatureBody).not.toHaveBeenCalled();
    // Both wipe queries fired even with nothing to clean — a future schema
    // drift that leaks orphan rows still gets cleaned by a manual run.
    const batchSqls = db._calls.batch[0].map((b) => b.sql);
    expect(batchSqls.some((s) => s.includes("DELETE FROM pr_feature_links"))).toBe(true);
    expect(batchSqls.some((s) => s.includes("DELETE FROM pr_match_attempts"))).toBe(true);
  });

  it("clears linkedPRs in every affected feature and wipes both tables", async () => {
    const db = makeDb({
      linkedFeatures: [10, 20],
      linkWipeChanges: 5,
      attemptWipeChanges: 30,
    });

    readFeatureIssue.mockImplementation(async (_tok, _org, number) => ({
      number,
      body: `Plan ${number}\n\n<!-- unticket:metadata\n${JSON.stringify({
        linkedPRs: [{ repo: "api", number: 100 + number }],
      })}\n-->`,
    }));
    updateFeatureBody.mockResolvedValue({});

    const res = await onRequestPost(makeContext({ db }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      featuresAffected: 2,
      featuresCleared: 2,
      linksDeleted: 5,
      attemptsCleared: 30,
      errors: [],
    });

    expect(readFeatureIssue).toHaveBeenCalledTimes(2);
    expect(updateFeatureBody).toHaveBeenCalledTimes(2);
    // Both PATCHes should drop linkedPRs (the serialized result has no metadata
    // block at all once linkedPRs is the only key and we set it to []).
    for (const call of updateFeatureBody.mock.calls) {
      const [, , , newBody] = call;
      expect(newBody).not.toContain("linkedPRs");
    }
  });

  it("skips GitHub PATCH when a feature has no linkedPRs in its metadata", async () => {
    const db = makeDb({ linkedFeatures: [42] });
    readFeatureIssue.mockResolvedValue({ number: 42, body: "Plain plan with no metadata block" });

    const res = await onRequestPost(makeContext({ db }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // featuresCleared still counts it (the iteration succeeded) but no PATCH
    // ran — saves a GitHub write for orphan link rows.
    expect(body.featuresCleared).toBe(1);
    expect(updateFeatureBody).not.toHaveBeenCalled();
  });
});

describe("POST /api/pr-links/unlink-all — partial failure", () => {
  it("records GitHub failures but still wipes D1", async () => {
    const db = makeDb({ linkedFeatures: [1, 2, 3], linkWipeChanges: 7 });
    readFeatureIssue.mockImplementation(async (_tok, _org, n) => {
      if (n === 2) throw new Error("GitHub 503");
      return {
        number: n,
        body: `x\n\n<!-- unticket:metadata\n${JSON.stringify({ linkedPRs: [{ repo: "a", number: n }] })}\n-->`,
      };
    });
    updateFeatureBody.mockResolvedValue({});

    const res = await onRequestPost(makeContext({ db }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.featuresAffected).toBe(3);
    expect(body.featuresCleared).toBe(2);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatch(/feature #2:.*GitHub 503/);
    expect(body.linksDeleted).toBe(7); // D1 wiped despite GitHub error
  });
});

// Sanity check: serializeFeatureMetadata genuinely returns the bare content
// when linkedPRs is the only field and we set it to [] — confirms the
// "no metadata block in PATCH" assertion above isn't testing a tautology.
describe("invariant", () => {
  it("serializeFeatureMetadata with empty linkedPRs returns content only", () => {
    expect(serializeFeatureMetadata("just content", { linkedPRs: [] })).toBe("just content");
  });
});
