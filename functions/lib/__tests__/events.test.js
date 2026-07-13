import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../actors.js", () => ({
  resolveActorFromGithub: vi.fn(async () => ({ id: "actor_x", name: "X", tone: "t" })),
}));
vi.mock("../gh-mirror.js", () => ({
  upsertGhUser: vi.fn(async () => {}),
}));
vi.mock("../narrator.js", () => ({
  narrateEvent: vi.fn(async () => {}),
}));

import { mapEventType, storeEvent, recordMergedPr } from "../events.js";
import { resolveActorFromGithub } from "../actors.js";
import { upsertGhUser } from "../gh-mirror.js";
import { narrateEvent } from "../narrator.js";

function makeDb({ insertRowId = 100 } = {}) {
  const calls = { runs: [] };
  function prepare(sql) {
    return {
      _sql: sql,
      _binds: [],
      bind(...binds) { this._binds = binds; return this; },
      async run() {
        calls.runs.push({ sql, binds: this._binds });
        if (sql.includes("INSERT INTO events")) {
          return { meta: { last_row_id: insertRowId } };
        }
        return { meta: { changes: 1 } };
      },
    };
  }
  return { prepare, _calls: calls };
}

beforeEach(() => {
  resolveActorFromGithub.mockClear();
  upsertGhUser.mockClear();
  narrateEvent.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("mapEventType", () => {
  it("maps pull_request actions", () => {
    expect(mapEventType("pull_request", "opened", {})).toBe("github:pr:opened");
    expect(mapEventType("pull_request", "closed", { pull_request: { merged: true } })).toBe("github:pr:merged");
    expect(mapEventType("pull_request", "closed", { pull_request: { merged: false } })).toBe("github:pr:closed");
    expect(mapEventType("pull_request", "reopened", {})).toBe("github:pr:reopened");
    expect(mapEventType("pull_request", "edited", {})).toBeNull();
  });

  it("maps push events", () => {
    expect(mapEventType("push", null, {})).toBe("github:push");
  });

  it("maps release:published only", () => {
    expect(mapEventType("release", "published", {})).toBe("github:release:published");
    expect(mapEventType("release", "edited", {})).toBeNull();
  });

  it("maps issue open/close only", () => {
    expect(mapEventType("issues", "opened", {})).toBe("github:issue:opened");
    expect(mapEventType("issues", "closed", {})).toBe("github:issue:closed");
    expect(mapEventType("issues", "labeled", {})).toBeNull();
  });

  it("maps pull_request_review by state", () => {
    expect(mapEventType("pull_request_review", "submitted", { review: { state: "approved" } })).toBe("github:pr:review:approved");
    expect(mapEventType("pull_request_review", "submitted", { review: { state: "changes_requested" } })).toBe("github:pr:review:changes_requested");
    expect(mapEventType("pull_request_review", "submitted", { review: { state: "commented" } })).toBe("github:pr:review:commented");
    expect(mapEventType("pull_request_review", "submitted", { review: { state: "dismissed" } })).toBeNull();
    expect(mapEventType("pull_request_review", "edited", {})).toBeNull();
  });

  it("maps repository lifecycle events", () => {
    for (const action of ["archived", "unarchived", "deleted", "transferred", "renamed"]) {
      expect(mapEventType("repository", action, {})).toBe(`github:repo:${action}`);
    }
    expect(mapEventType("repository", "edited", {})).toBeNull();
  });

  it("maps installation + installation_repositories with action", () => {
    expect(mapEventType("installation", "created", {})).toBe("github:installation:created");
    expect(mapEventType("installation", null, {})).toBe("github:installation:unknown");
    expect(mapEventType("installation_repositories", "added", {})).toBe("github:installation_repos:added");
  });

  it("returns null for unknown event types", () => {
    expect(mapEventType("watch", "started", {})).toBeNull();
  });
});

describe("storeEvent", () => {
  const basePr = {
    action: "opened",
    pull_request: {
      number: 1,
      title: "Hello",
      user: { id: 5, login: "octocat", type: "User", avatar_url: "a.png" },
      additions: 1, deletions: 0, changed_files: 1,
    },
    repository: { name: "unticket", owner: { login: "no-box-dev" } },
    organization: { login: "no-box-dev" },
  };

  it("returns null when event type is unrecognized", async () => {
    const db = makeDb();
    expect(await storeEvent(db, "watch", "del-1", { action: "started" }, "owner-1")).toBeNull();
    expect(db._calls.runs).toHaveLength(0);
  });

  it("inserts a project row and an event row, returning the id + type", async () => {
    const db = makeDb({ insertRowId: 42 });
    const result = await storeEvent(db, "pull_request", "del-1", basePr, "owner-1");
    // The webhook branches on `type` to pick the right narrator task, so
    // storeEvent's return contract includes the mapped type as well as the id.
    expect(result).toEqual({ id: 42, type: "github:pr:opened" });
    const sqls = db._calls.runs.map((r) => r.sql).join(" || ");
    expect(sqls).toContain("INSERT OR IGNORE INTO projects");
    expect(sqls).toContain("INSERT INTO events");
  });

  it("returns null when D1 reports no last_row_id (delivery_id collision)", async () => {
    const db = makeDb({ insertRowId: 0 });
    expect(await storeEvent(db, "pull_request", "dup", basePr, "owner-1")).toBeNull();
  });

  it("upserts the author via gh_users and resolves an actor", async () => {
    await storeEvent(makeDb(), "pull_request", "del-1", basePr, "owner-1");
    expect(upsertGhUser).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      id: 5,
      login: "octocat",
      type: "User",
    }));
    expect(resolveActorFromGithub).toHaveBeenCalled();
  });

  it("survives gh_user upsert failures (logs + continues)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    upsertGhUser.mockRejectedValueOnce(new Error("D1 boom"));
    const result = await storeEvent(makeDb(), "pull_request", "del-1", basePr, "owner-1");
    expect(result).toEqual({ id: 100, type: "github:pr:opened" });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("builds the PR summary as 'PR #N: title'", async () => {
    const db = makeDb();
    await storeEvent(db, "pull_request", "del-1", basePr, "owner-1");
    const eventInsert = db._calls.runs.find((r) => r.sql.includes("INSERT INTO events"));
    // binds[7] is summary
    expect(eventInsert.binds[7]).toBe("PR #1: Hello");
  });

  it("builds the push summary with branch + commit count", async () => {
    const db = makeDb();
    await storeEvent(db, "push", "del-2", {
      ref: "refs/heads/main",
      commits: [{ id: "c1", message: "fix", author: { name: "x" } }],
      repository: { name: "unticket", owner: { login: "no-box-dev" } },
      sender: { login: "octocat", id: 5 },
    }, "owner-1");
    const eventInsert = db._calls.runs.find((r) => r.sql.includes("INSERT INTO events"));
    expect(eventInsert.binds[7]).toBe("Push to main (1 commit)");
  });

  it("plural commits when count != 1", async () => {
    const db = makeDb();
    await storeEvent(db, "push", "del-3", {
      ref: "refs/heads/main",
      commits: [{}, {}, {}],
      repository: { name: "unticket", owner: { login: "no-box-dev" } },
      sender: { login: "x", id: 1 },
    }, "owner-1");
    const eventInsert = db._calls.runs.find((r) => r.sql.includes("INSERT INTO events"));
    expect(eventInsert.binds[7]).toContain("(3 commits)");
  });

  it("builds release summary with tag name", async () => {
    const db = makeDb();
    await storeEvent(db, "release", "del-4", {
      action: "published",
      release: { tag_name: "v1.0.0", author: { login: "x", id: 1 } },
      repository: { name: "unticket", owner: { login: "no-box-dev" } },
    }, "owner-1");
    const eventInsert = db._calls.runs.find((r) => r.sql.includes("INSERT INTO events"));
    expect(eventInsert.binds[7]).toBe("Release v1.0.0");
  });

  it("slims push payload — caps commit count at 10 + truncates messages at 200 chars", async () => {
    const db = makeDb();
    const commits = Array.from({ length: 15 }, (_, i) => ({
      id: `c${i}`,
      message: "x".repeat(500),
      author: { name: "a" },
    }));
    await storeEvent(db, "push", "del-5", {
      ref: "refs/heads/main",
      commits,
      repository: { name: "unticket", owner: { login: "no-box-dev" } },
      sender: { login: "x", id: 1 },
    }, "owner-1");
    const eventInsert = db._calls.runs.find((r) => r.sql.includes("INSERT INTO events"));
    const payload = JSON.parse(eventInsert.binds[8]);
    expect(payload.commits).toHaveLength(10);
    expect(payload.commits[0].message.length).toBe(200);
  });

  it("uses sender as author when typed author is absent", async () => {
    await storeEvent(makeDb(), "push", "del-6", {
      ref: "refs/heads/main",
      commits: [],
      repository: { name: "unticket", owner: { login: "no-box-dev" } },
      sender: { login: "octocat", id: 5, type: "User" },
    }, "owner-1");
    // First call to resolveActorFromGithub gets the sender (octocat).
    expect(resolveActorFromGithub.mock.calls[0][2]).toMatchObject({ login: "octocat" });
  });
});

describe("recordMergedPr", () => {
  const PR = {
    number: 42,
    title: "Add login",
    user: { id: 5, login: "octocat", type: "User", avatar_url: "a.png" },
    merged_at: "2026-05-15T10:00:00Z",
    additions: 5, deletions: 1, changed_files: 2,
    body: "Closes #1",
  };

  it("returns null when PR is missing critical fields", async () => {
    const env = { DB: makeDb() };
    expect(await recordMergedPr(env, { pr: {} })).toBeNull();
    expect(await recordMergedPr(env, { pr: { number: 1, user: {} } })).toBeNull();
    expect(await recordMergedPr(env, { pr: { number: 1, user: { login: "x" } } })).toBeNull();
  });

  it("returns null when actor resolution fails", async () => {
    resolveActorFromGithub.mockResolvedValueOnce(null);
    const env = { DB: makeDb() };
    expect(await recordMergedPr(env, {
      ownerId: "o", projectId: "p", org: "no-box-dev", repo: "x",
      deliveryId: "d", source: "backfill", pr: PR,
    })).toBeNull();
  });

  it("inserts a merged event and triggers narration", async () => {
    const db = makeDb({ insertRowId: 77 });
    const env = { DB: db };
    const result = await recordMergedPr(env, {
      ownerId: "owner-1", projectId: "proj-1", org: "no-box-dev", repo: "unticket",
      deliveryId: "del-99", source: "backfill", pr: PR,
    });
    expect(result).toEqual({ id: 77 });
    expect(narrateEvent).toHaveBeenCalledWith(env, 77);
    const eventInsert = db._calls.runs.find((r) => r.sql.includes("INSERT INTO events"));
    expect(eventInsert.binds[1]).toBe("backfill");  // source
    expect(eventInsert.binds[6]).toBe("PR #42: Add login");
    // created_at = pr.merged_at
    expect(eventInsert.binds[9]).toBe("2026-05-15T10:00:00Z");
  });

  it("returns null when D1 reports no last_row_id (dup delivery)", async () => {
    const env = { DB: makeDb({ insertRowId: 0 }) };
    const result = await recordMergedPr(env, {
      ownerId: "o", projectId: "p", org: "x", repo: "y",
      deliveryId: "dup", source: "backfill", pr: PR,
    });
    expect(result).toBeNull();
    expect(narrateEvent).not.toHaveBeenCalled();
  });

  it("survives gh_users upsert failure", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    upsertGhUser.mockRejectedValueOnce(new Error("boom"));
    const env = { DB: makeDb({ insertRowId: 1 }) };
    const result = await recordMergedPr(env, {
      ownerId: "o", projectId: "p", org: "x", repo: "y",
      deliveryId: "d", source: "backfill", pr: PR,
    });
    expect(result).toEqual({ id: 1 });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
