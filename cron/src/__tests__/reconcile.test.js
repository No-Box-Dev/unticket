import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the cross-package imports so reconcile.js loads cleanly without
// pulling real DB SQL or App JWT signing into the test.
vi.mock("../../../functions/lib/github-app.js", () => ({
  getInstallationToken: vi.fn().mockResolvedValue("install-token"),
}));

vi.mock("../../../functions/lib/inactive-repos.js", () => ({
  getInactiveRepoSet: vi.fn().mockResolvedValue(new Set()),
}));

vi.mock("../../../functions/lib/github-sync.js", () => ({
  syncRepos: vi.fn(),
  syncMembers: vi.fn(),
  syncFeatures: vi.fn(),
  syncPRs: vi.fn(),
  syncIssues: vi.fn(),
  removeRepo: vi.fn(),
  removeMember: vi.fn(),
}));

import { reconcileOrg } from "../reconcile.js";
import {
  syncRepos,
  syncMembers,
  syncFeatures,
  syncPRs,
  syncIssues,
  removeRepo,
  removeMember,
} from "../../../functions/lib/github-sync.js";

// ---- D1 stub: small dispatch table mapping SQL pattern → handler.
// Tests mutate `state` and `match` to control behaviour.

function makeDb({
  members = [],          // logins (strings) currently in D1
  repos = [],            // names (strings) currently in D1
  syncCursors = {},      // resource → last_synced
  recentUnfinishedRun = false,
  lastEventAt = null,    // orgs.last_event_at
  reconcileInsertId = 99,
} = {}) {
  const calls = { runs: [], updates: [] };

  function prepare(sql) {
    return {
      _sql: sql,
      _binds: [],
      bind(...binds) { this._binds = binds; return this; },
      async first() {
        if (sql.includes("FROM reconcile_runs") && sql.includes("finished_at IS NULL")) {
          return recentUnfinishedRun ? { id: 1 } : null;
        }
        if (sql.includes("INSERT INTO reconcile_runs") && sql.includes("RETURNING id")) {
          calls.runs.push({ kind: "insert", binds: this._binds });
          return { id: reconcileInsertId };
        }
        if (sql.includes("FROM sync_state")) {
          const [, resource] = this._binds;
          const last = syncCursors[resource];
          return last ? { last_synced: last } : null;
        }
        if (sql.includes("SELECT last_event_at FROM orgs")) {
          return { last_event_at: lastEventAt };
        }
        return null;
      },
      async all() {
        if (sql.includes("SELECT login FROM members")) {
          return { results: members.map((login) => ({ login })) };
        }
        if (sql.includes("SELECT name FROM repos")) {
          return { results: repos.map((name) => ({ name })) };
        }
        return { results: [] };
      },
      async run() {
        if (sql.includes("UPDATE reconcile_runs")) {
          calls.runs.push({ kind: "update", sql, binds: this._binds });
        } else if (sql.includes("UPDATE installations SET health_status")) {
          calls.updates.push({ kind: "health", binds: this._binds });
        } else {
          calls.updates.push({ kind: "other", sql, binds: this._binds });
        }
        return {};
      },
    };
  }

  return {
    prepare,
    async batch(stmts) { return Promise.all(stmts.map((s) => s.run())); },
    _calls: calls,
  };
}

const env = {};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reconcileOrg", () => {
  it("upserts then diffs members and repos for deletes", async () => {
    syncMembers.mockResolvedValue(["alice", "bob"]);             // API truth
    syncRepos.mockResolvedValue(["app", "core"]);                 // API truth
    const db = makeDb({
      members: ["alice", "bob", "ghost"],   // ghost no longer in API
      repos: ["app", "core", "old-repo"],   // old-repo no longer in API
      lastEventAt: new Date().toISOString().replace("T", " ").slice(0, 19),
    });

    await reconcileOrg(env, db, 42, "acme", 12345);

    expect(syncMembers).toHaveBeenCalledOnce();
    expect(syncRepos).toHaveBeenCalledOnce();
    expect(syncFeatures).toHaveBeenCalledOnce();

    // Stale members + repos removed; live ones never touched.
    expect(removeMember).toHaveBeenCalledWith(db, 42, "ghost");
    expect(removeMember).toHaveBeenCalledTimes(1);
    expect(removeRepo).toHaveBeenCalledWith(db, 42, "old-repo");
    expect(removeRepo).toHaveBeenCalledTimes(1);
  });

  it("calls syncPRs/syncIssues per active repo with the stored since cursor", async () => {
    syncMembers.mockResolvedValue([]);
    syncRepos.mockResolvedValue(["app", "core"]);
    const db = makeDb({
      members: [],
      repos: ["app", "core"],
      syncCursors: {
        "prs:app": "2026-05-10 12:00:00",
        "issues:app": "2026-05-10 11:00:00",
      },
      lastEventAt: new Date().toISOString().replace("T", " ").slice(0, 19),
    });

    await reconcileOrg(env, db, 1, "acme", 99);

    expect(syncPRs).toHaveBeenCalledWith(db, "install-token", 1, "acme", "app", "2026-05-10 12:00:00");
    expect(syncIssues).toHaveBeenCalledWith(db, "install-token", 1, "acme", "app", "2026-05-10 11:00:00");
    expect(syncPRs).toHaveBeenCalledWith(db, "install-token", 1, "acme", "core", null);
    expect(syncIssues).toHaveBeenCalledWith(db, "install-token", 1, "acme", "core", null);
  });

  it("skips the tick when a prior unfinished run is recent", async () => {
    syncMembers.mockResolvedValue([]);
    syncRepos.mockResolvedValue([]);
    const db = makeDb({ recentUnfinishedRun: true });

    await reconcileOrg(env, db, 1, "acme", 99);

    expect(syncMembers).not.toHaveBeenCalled();
    expect(syncRepos).not.toHaveBeenCalled();
    expect(syncFeatures).not.toHaveBeenCalled();
    expect(db._calls.runs).toHaveLength(0);
  });

  it("flags installation as silent when last_event_at is older than 24h", async () => {
    syncMembers.mockResolvedValue([]);
    syncRepos.mockResolvedValue([]);
    const oldStamp = new Date(Date.now() - 26 * 60 * 60 * 1000)
      .toISOString().replace("T", " ").slice(0, 19);
    const db = makeDb({ lastEventAt: oldStamp });

    await reconcileOrg(env, db, 1, "acme", 555);

    const healthCall = db._calls.updates.find((u) => u.kind === "health");
    expect(healthCall).toBeDefined();
    expect(healthCall.binds).toEqual(["silent", 555]);
  });

  it("clears health_status when last_event_at is recent", async () => {
    syncMembers.mockResolvedValue([]);
    syncRepos.mockResolvedValue([]);
    const recentStamp = new Date(Date.now() - 60 * 60 * 1000)
      .toISOString().replace("T", " ").slice(0, 19);
    const db = makeDb({ lastEventAt: recentStamp });

    await reconcileOrg(env, db, 1, "acme", 555);

    const healthCall = db._calls.updates.find((u) => u.kind === "health");
    expect(healthCall.binds).toEqual([null, 555]);
  });

  it("records duration_ms + error on the reconcile_runs row when sync throws", async () => {
    syncMembers.mockResolvedValue([]);
    syncRepos.mockRejectedValue(new Error("rate limit"));
    const db = makeDb();

    await expect(reconcileOrg(env, db, 1, "acme", 1)).rejects.toThrow("rate limit");

    const update = db._calls.runs.find(
      (r) => r.kind === "update" && r.sql.includes("error = ?"),
    );
    expect(update).toBeDefined();
    expect(update.binds[1]).toBe("rate limit");
  });
});
