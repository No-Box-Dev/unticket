import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../feature-metadata.js", () => ({
  parseFeatureMetadata: vi.fn(() => ({ metadata: {} })),
  parseFeatureFromBranch: vi.fn(() => null),
  parseFeaturesFromBody: vi.fn(() => []),
}));
vi.mock("../inactive-repos.js", () => ({
  filterInactive: vi.fn(async (_db, _o, _l, names) => names),
  getUnticketRepoName: vi.fn(async () => "unticket"),
}));
vi.mock("../github-app.js", () => ({
  getInstallationToken: vi.fn(async () => "ghs_token"),
}));
vi.mock("../gh-mirror.js", () => ({
  upsertGhUser: vi.fn(async () => {}),
}));
vi.mock("../feature-matcher.js", () => ({
  matchPRToFeatures: vi.fn(async () => null),
}));
vi.mock("../db.js", async () => {
  const actual = await vi.importActual("../db.js");
  return {
    ...actual,
    getSyncState: vi.fn(async () => null),
    setSyncState: vi.fn(async () => {}),
  };
});

import {
  upsertIssue,
  upsertFeature,
  upsertPR,
  upsertMember,
  removeMember,
  upsertTeam,
  removeTeam,
  addTeamMember,
  removeTeamMember,
  markRepoArchived,
  removeRepo,
  renameRepo,
  touchRepoPushed,
  syncRepos,
  syncMembers,
  syncRepo,
} from "../github-sync.js";
import { parseFeatureFromBranch, parseFeaturesFromBody } from "../feature-metadata.js";

function makeDb(rowsForSql = {}) {
  // rowsForSql: { sqlSubstring: row | rows }
  const calls = { firsts: [], runs: [], batches: [], alls: [] };
  function prepare(sql) {
    return {
      _sql: sql,
      _binds: [],
      bind(...binds) { this._binds = binds; return this; },
      async first() {
        calls.firsts.push({ sql, binds: this._binds });
        for (const [k, v] of Object.entries(rowsForSql)) {
          if (sql.includes(k)) return Array.isArray(v) ? v[0] : v;
        }
        return null;
      },
      async all() {
        calls.alls.push({ sql, binds: this._binds });
        for (const [k, v] of Object.entries(rowsForSql)) {
          if (sql.includes(k)) return { results: Array.isArray(v) ? v : [v] };
        }
        return { results: [] };
      },
      async run() {
        calls.runs.push({ sql, binds: this._binds });
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

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ============================================================
// Single-row webhook upsert/remove helpers — these test the easy
// branches; sync* functions get integration-style tests below.
// ============================================================

describe("upsertIssue", () => {
  const baseIssue = {
    number: 1, title: "x", state: "open",
    user: { login: "octocat", avatar_url: "a.png" },
    created_at: "2026-05-01", updated_at: "2026-05-01",
    closed_at: null, html_url: "u",
    assignees: [{ login: "a", avatar_url: "b" }],
    labels: [{ name: "bug", color: "red" }],
    milestone: { title: "M1" },
  };

  it("inserts/upserts with closedBy=null by default", async () => {
    const db = makeDb();
    await upsertIssue(db, "org", "api", baseIssue);
    expect(db._calls.runs).toHaveLength(1);
    expect(db._calls.runs[0].sql).toContain("INSERT INTO issues");
    expect(db._calls.runs[0].binds[14]).toBeNull();  // closed_by
  });

  it("passes closedBy through when provided", async () => {
    const db = makeDb();
    await upsertIssue(db, "org", "api", { ...baseIssue, state: "closed" }, "alice");
    expect(db._calls.runs[0].binds[14]).toBe("alice");
  });

  it("tolerates missing user/assignees/labels arrays", async () => {
    const db = makeDb();
    await upsertIssue(db, "org", "api", { ...baseIssue, user: null, assignees: null, labels: null });
    const r = db._calls.runs[0];
    expect(r.binds[5]).toBeNull();  // author
    expect(r.binds[11]).toBe("[]");  // assignees_json
    expect(r.binds[12]).toBe("[]");  // labels_json
  });
});

describe("upsertFeature", () => {
  it("DELETEs feature row when labels don't include both unticket+feature", async () => {
    const db = makeDb();
    await upsertFeature(db, "org", { number: 1, labels: [{ name: "bug" }] });
    expect(db._calls.runs[0].sql).toContain("DELETE FROM features");
  });

  it("requires both 'unticket' AND 'feature' labels", async () => {
    const db = makeDb();
    await upsertFeature(db, "org", { number: 1, labels: [{ name: "feature" }] });
    expect(db._calls.runs[0].sql).toContain("DELETE");

    await upsertFeature(db, "org", { number: 2, labels: [{ name: "unticket" }] });
    expect(db._calls.runs[1].sql).toContain("DELETE");
  });

  it("upserts when both labels are present", async () => {
    const db = makeDb();
    await upsertFeature(db, "org", {
      number: 5, title: "F", state: "open", body: "b",
      labels: [{ name: "unticket" }, { name: "feature" }],
      assignees: [], html_url: "u",
      created_at: "2026-05-01", updated_at: "2026-05-01",
    });
    expect(db._calls.runs[0].sql).toContain("INSERT INTO features");
  });

  it("accepts string labels (legacy format)", async () => {
    const db = makeDb();
    await upsertFeature(db, "org", {
      number: 5, title: "F", state: "open",
      labels: ["unticket", "feature"],
      assignees: [], html_url: "u",
      created_at: "x", updated_at: "x",
    });
    expect(db._calls.runs[0].sql).toContain("INSERT INTO features");
  });
});

describe("upsertPR", () => {
  it("maps state='merged' when pr.merged is true", async () => {
    const db = makeDb();
    await upsertPR(db, "org", "api", {
      number: 1, title: "x", state: "closed", merged: true,
      user: { login: "x" }, created_at: "a", updated_at: "b", html_url: "u",
    });
    expect(db._calls.runs[0].binds[4]).toBe("merged");
  });

  it("preserves state when not merged", async () => {
    const db = makeDb();
    await upsertPR(db, "org", "api", {
      number: 1, title: "x", state: "open", merged: false,
      user: { login: "x" }, created_at: "a", updated_at: "b", html_url: "u",
    });
    expect(db._calls.runs[0].binds[4]).toBe("open");
  });

  it("draft 1/0 binding", async () => {
    const db = makeDb();
    await upsertPR(db, "org", "api", {
      number: 1, title: "x", state: "open", draft: true,
      user: { login: "x" }, created_at: "a", updated_at: "b", html_url: "u",
    });
    expect(db._calls.runs[0].binds[7]).toBe(1);
    await upsertPR(db, "org", "api", {
      number: 2, title: "x", state: "open", draft: false,
      user: { login: "x" }, created_at: "a", updated_at: "b", html_url: "u",
    });
    expect(db._calls.runs[1].binds[7]).toBe(0);
  });
});

describe("upsertMember + removeMember", () => {
  it("upsertMember defaults kind='human'", async () => {
    const db = makeDb();
    await upsertMember(db, "org", { login: "x", avatar_url: "a" });
    expect(db._calls.runs[0].binds).toEqual(["org", "x", "a", "human"]);
  });

  it("upsertMember accepts kind='bot'", async () => {
    const db = makeDb();
    await upsertMember(db, "org", { login: "dep", avatar_url: null }, "bot");
    expect(db._calls.runs[0].binds[3]).toBe("bot");
  });

  it("removeMember runs DELETE", async () => {
    const db = makeDb();
    await removeMember(db, "org", "x");
    expect(db._calls.runs[0].sql).toContain("DELETE FROM members");
    expect(db._calls.runs[0].binds).toEqual(["org", "x"]);
  });
});

describe("team helpers", () => {
  it("upsertTeam no-ops when team has no id", async () => {
    const db = makeDb();
    await upsertTeam(db, "org", { slug: "x" });
    expect(db._calls.runs).toHaveLength(0);
  });

  it("upsertTeam runs INSERT...ON CONFLICT", async () => {
    const db = makeDb();
    await upsertTeam(db, "org", { id: 5, slug: "core", name: "Core" });
    expect(db._calls.runs[0].sql).toContain("INSERT INTO teams");
  });

  it("removeTeam batches both deletes", async () => {
    const db = makeDb();
    await removeTeam(db, "org", 5);
    expect(db._calls.batches).toHaveLength(1);
    expect(db._calls.batches[0]).toHaveLength(2);
  });

  it("removeTeam no-ops when id missing", async () => {
    const db = makeDb();
    await removeTeam(db, "org", null);
    expect(db._calls.batches).toHaveLength(0);
  });

  it("addTeamMember no-ops when teamId or login missing", async () => {
    const db = makeDb();
    await addTeamMember(db, "org", null, "x");
    await addTeamMember(db, "org", 5, null);
    expect(db._calls.runs).toHaveLength(0);
  });

  it("addTeamMember inserts when both provided", async () => {
    const db = makeDb();
    await addTeamMember(db, "org", 5, "alice");
    expect(db._calls.runs[0].sql).toContain("INSERT INTO team_memberships");
  });

  it("removeTeamMember deletes the membership", async () => {
    const db = makeDb();
    await removeTeamMember(db, "org", 5, "alice");
    expect(db._calls.runs[0].sql).toContain("DELETE FROM team_memberships");
  });

  it("removeTeamMember no-ops when teamId or login missing", async () => {
    const db = makeDb();
    await removeTeamMember(db, "org", null, "x");
    await removeTeamMember(db, "org", 5, null);
    expect(db._calls.runs).toHaveLength(0);
  });
});

describe("repo lifecycle helpers", () => {
  it("markRepoArchived updates archived_at", async () => {
    const db = makeDb();
    await markRepoArchived(db, "org", "api");
    expect(db._calls.runs[0].sql).toContain("UPDATE repos SET archived_at");
  });

  it("removeRepo batches 4 DELETE statements", async () => {
    const db = makeDb();
    await removeRepo(db, "org", "api");
    expect(db._calls.batches).toHaveLength(1);
    const sqls = db._calls.batches[0].map((s) => s.sql).join(" || ");
    expect(sqls).toContain("DELETE FROM issues");
    expect(sqls).toContain("DELETE FROM pull_requests");
    expect(sqls).toContain("DELETE FROM pr_feature_links");
    expect(sqls).toContain("DELETE FROM repos");
  });

  it("renameRepo no-ops when names missing or identical", async () => {
    const db = makeDb();
    await renameRepo(db, "org", null, "x");
    await renameRepo(db, "org", "x", null);
    await renameRepo(db, "org", "x", "x");
    expect(db._calls.batches).toHaveLength(0);
  });

  it("renameRepo updates 4 tables in a single batch", async () => {
    const db = makeDb();
    await renameRepo(db, "org", "old", "new");
    expect(db._calls.batches).toHaveLength(1);
    expect(db._calls.batches[0]).toHaveLength(4);
  });

  it("touchRepoPushed updates pushed_at", async () => {
    const db = makeDb();
    await touchRepoPushed(db, "org", "api");
    expect(db._calls.runs[0].sql).toContain("UPDATE repos SET pushed_at");
  });
});

// ============================================================
// Network-touching sync functions — mock fetch.
// ============================================================

describe("syncRepos", () => {
  it("calls /orgs/{login}/repos and upserts each", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null },
      json: async () => [
        { name: "api", language: "TS", pushed_at: "2026-05-01" },
        { name: "web", language: "JS", pushed_at: "2026-05-02" },
      ],
    });
    const db = makeDb();
    const result = await syncRepos(db, "tok", "org-1", "no-box-dev");
    expect(result).toEqual(["api", "web"]);
    expect(fetch.mock.calls[0][0]).toContain("/orgs/no-box-dev/repos");
    expect(db._calls.batches).toHaveLength(1);
  });

  it("throws clear error on 401 (token revoked)", async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => null },
      statusText: "Unauthorized",
    });
    await expect(syncRepos(makeDb(), "tok", "org-1", "x")).rejects.toThrow(/token expired|revoked/i);
  });

  it("throws rate-limit error on 429", async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 429,
      headers: {
        get: (k) => k === "X-RateLimit-Reset" ? "1717200000" : null,
      },
      statusText: "Too Many Requests",
    });
    await expect(syncRepos(makeDb(), "tok", "org-1", "x")).rejects.toThrow(/rate limit/i);
  });

  it("throws on generic 5xx (does not return empty)", async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => null },
      statusText: "Internal Server Error",
    });
    await expect(syncRepos(makeDb(), "tok", "org-1", "x")).rejects.toThrow(/500/);
  });
});

describe("syncMembers", () => {
  it("upserts members with kind='human' (default)", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null },
      json: async () => [{ login: "alice", avatar_url: "a.png" }],
    });
    const db = makeDb();
    const result = await syncMembers(db, "tok", "org-1", "x");
    expect(result).toEqual(["alice"]);
    // The INSERT SQL hardcodes 'human' as the kind.
    expect(db._calls.batches[0][0].sql).toContain("'human'");
  });
});

describe("syncRepo orchestration", () => {
  it("calls syncPRs then syncIssues, both with the since cursor", async () => {
    // Single page of PRs, single page of issues
    fetch
      .mockResolvedValueOnce({
        ok: true, headers: { get: () => null },
        json: async () => [],
      })  // PRs
      .mockResolvedValueOnce({
        ok: true, headers: { get: () => null },
        json: async () => [],
      });  // Issues
    const db = makeDb();
    await syncRepo(db, "tok", "org-1", "no-box-dev", "api", true);
    // PR URL first, issues URL second.
    expect(fetch.mock.calls[0][0]).toContain("/repos/no-box-dev/api/pulls");
    expect(fetch.mock.calls[1][0]).toContain("/repos/no-box-dev/api/issues");
  });

  it("propagates errors from underlying syncs", async () => {
    fetch.mockResolvedValue({
      ok: false, status: 500, headers: { get: () => null }, statusText: "x",
    });
    await expect(syncRepo(makeDb(), "tok", "org-1", "x", "api", true)).rejects.toThrow();
  });
});

describe("syncPRs feature-link extraction", () => {
  it("creates branch + body feature links per PR", async () => {
    parseFeatureFromBranch.mockReturnValue(42);
    parseFeaturesFromBody.mockReturnValue([43]);
    fetch.mockResolvedValueOnce({
      ok: true, headers: { get: () => null },
      json: async () => [
        {
          number: 1, title: "x", state: "open",
          user: { login: "octo", id: 1, avatar_url: "a", type: "User" },
          draft: false,
          head: { ref: "feat/42-x" },
          base: { ref: "main" },
          merged_at: null, created_at: "a", updated_at: "b",
          html_url: "u", requested_reviewers: [], labels: [],
          body: "Implements #43",
        },
      ],
    });
    const db = makeDb();
    // Imports inside the source modules are already mocked at top.
    const { syncPRs } = await import("../github-sync.js");
    await syncPRs(db, "tok", "org-1", "no-box-dev", "api", null);
    const linkBatch = db._calls.batches.find((b) =>
      b.some((s) => s.sql.includes("INSERT INTO pr_feature_links")),
    );
    expect(linkBatch).toBeDefined();
    expect(linkBatch).toHaveLength(2);  // branch + body
  });
});
