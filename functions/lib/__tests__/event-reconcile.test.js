import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../actors.js", () => ({
  resolveActorFromGithub: vi.fn(async (_db, _o, gh) =>
    gh?.login ? { id: `actor_${gh.login}`, name: gh.login } : null,
  ),
}));
vi.mock("../gh-mirror.js", () => ({
  upsertGhUser: vi.fn(async () => {}),
}));
vi.mock("../narrator.js", () => ({
  narrateEvent: vi.fn(async () => {}),
}));

import { reconcileRepoEvents, translateGithubEvent } from "../event-reconcile.js";
import { resolveActorFromGithub } from "../actors.js";
import { upsertGhUser } from "../gh-mirror.js";
import { narrateEvent } from "../narrator.js";

// Tiny D1 stand-in. Routes prepare() to handlers keyed on a substring of the
// SQL string. Each handler returns the rows / row / run-result it wants.
// Anything unmatched returns empty results, mirroring the production shape.
function makeDb(handlers = {}) {
  const calls = { runs: [], firsts: [], alls: [] };
  let nextRowId = 1000;
  return {
    _calls: calls,
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _binds: [],
        bind(...binds) { this._binds = binds; return this; },
        async first() {
          calls.firsts.push({ sql, binds: this._binds });
          for (const [needle, fn] of Object.entries(handlers.first ?? {})) {
            if (sql.includes(needle)) return fn(this._binds);
          }
          return null;
        },
        async all() {
          calls.alls.push({ sql, binds: this._binds });
          for (const [needle, fn] of Object.entries(handlers.all ?? {})) {
            if (sql.includes(needle)) return { results: fn(this._binds) };
          }
          return { results: [] };
        },
        async run() {
          calls.runs.push({ sql, binds: this._binds });
          for (const [needle, fn] of Object.entries(handlers.run ?? {})) {
            if (sql.includes(needle)) {
              const out = fn(this._binds);
              if (out) return out;
            }
          }
          if (sql.includes("INSERT INTO events")) {
            return { meta: { last_row_id: nextRowId++ } };
          }
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
}

beforeEach(() => {
  resolveActorFromGithub.mockClear();
  upsertGhUser.mockClear();
  narrateEvent.mockClear();
  global.fetch = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe("translateGithubEvent", () => {
  it("maps PullRequestReviewEvent by review state", () => {
    const out = translateGithubEvent({
      type: "PullRequestReviewEvent",
      actor: { login: "alice", id: 1, avatar_url: "a.png" },
      payload: {
        action: "submitted",
        review: { state: "approved", body: "lgtm", submitted_at: "2026-05-19T10:00:00Z" },
        pull_request: { number: 42, title: "Add feature", user: { login: "bob" } },
      },
      created_at: "2026-05-19T10:00:00Z",
    });
    expect(out.type).toBe("github:pr:review:approved");
    expect(out.author.login).toBe("alice");
    expect(out.summary).toContain("PR #42");
    expect(out.payload.review.state).toBe("approved");
  });

  it("returns null for non-submitted reviews and dismissed state", () => {
    expect(
      translateGithubEvent({
        type: "PullRequestReviewEvent",
        actor: { login: "a" },
        payload: { action: "edited", review: { state: "approved" } },
      }),
    ).toBeNull();
    expect(
      translateGithubEvent({
        type: "PullRequestReviewEvent",
        actor: { login: "a" },
        payload: { action: "submitted", review: { state: "dismissed" } },
      }),
    ).toBeNull();
  });

  it("maps PushEvent with branch + commit count", () => {
    const out = translateGithubEvent({
      type: "PushEvent",
      actor: { login: "carol", id: 2 },
      payload: {
        ref: "refs/heads/main",
        commits: [
          { sha: "abc", message: "fix bug", author: { name: "Carol" } },
          { sha: "def", message: "lint", author: { name: "Carol" } },
        ],
      },
    });
    expect(out.type).toBe("github:push");
    expect(out.summary).toBe("Push to main (2 commits)");
    expect(out.payload.commits).toHaveLength(2);
  });

  it("maps ReleaseEvent published only", () => {
    expect(
      translateGithubEvent({
        type: "ReleaseEvent",
        actor: { login: "dan" },
        payload: { action: "published", release: { tag_name: "v1.0.0" } },
      }).type,
    ).toBe("github:release:published");
    expect(
      translateGithubEvent({
        type: "ReleaseEvent",
        actor: { login: "dan" },
        payload: { action: "edited", release: { tag_name: "v1.0.0" } },
      }),
    ).toBeNull();
  });

  it("returns null for unsupported event types", () => {
    expect(translateGithubEvent({ type: "WatchEvent", actor: { login: "x" } })).toBeNull();
    expect(translateGithubEvent({ type: "CreateEvent", actor: { login: "x" } })).toBeNull();
  });
});

describe("reconcileRepoEvents — D1 PR backfill", () => {
  it("inserts a github:pr:opened row when none exists", async () => {
    const db = makeDb({
      all: {
        "FROM pull_requests pr": (binds) => {
          // Only return data when filtering for `opened` query (created_at filter)
          // We disambiguate by which type bind ($7) is in use:
          const type = binds[5];
          if (type === "github:pr:opened") {
            return [
              {
                number: 42,
                title: "Big feature",
                author: "alice",
                author_avatar: "a.png",
                event_at: "2026-05-18T10:00:00Z",
                user_id: 1,
                user_type: "User",
                user_name: "Alice",
              },
            ];
          }
          return [];
        },
        "FROM issues i": () => [],
      },
    });

    const counts = await reconcileRepoEvents({}, db, {
      orgId: 7,
      orgLogin: "noboxdev",
      repo: "gitpulse",
      token: null,
      lookbackHours: 720,
      includeGithubEvents: false,
    });

    expect(counts.prOpened).toBe(1);
    expect(counts.prClosed).toBe(0);

    const eventInserts = db._calls.runs.filter((r) =>
      r.sql.includes("INSERT INTO events"),
    );
    expect(eventInserts).toHaveLength(1);
    const binds = eventInserts[0].binds;
    expect(binds[0]).toBe("reconcile:noboxdev:gitpulse:pr-42:opened");
    expect(binds[1]).toBe("github:pr:opened"); // type
    expect(binds[9]).toBe("2026-05-18T10:00:00Z"); // created_at = PR created_at
    expect(narrateEvent).toHaveBeenCalled();
  });

  it("skips PR rows without an upserted gh_user (user_id null)", async () => {
    const db = makeDb({
      all: {
        "FROM pull_requests pr": (binds) => {
          if (binds[5] === "github:pr:opened") {
            return [
              {
                number: 1,
                title: "x",
                author: "ghost",
                author_avatar: null,
                event_at: "2026-05-18T10:00:00Z",
                user_id: null,
                user_type: null,
                user_name: null,
              },
            ];
          }
          return [];
        },
      },
    });
    const counts = await reconcileRepoEvents({}, db, {
      orgId: 1,
      orgLogin: "o",
      repo: "r",
      lookbackHours: 24,
      includeGithubEvents: false,
    });
    expect(counts.prOpened).toBe(0);
    expect(db._calls.runs.some((r) => r.sql.includes("INSERT INTO events"))).toBe(false);
  });

  it("uses merged_at for github:pr:merged event timestamp", async () => {
    const db = makeDb({
      all: {
        "FROM pull_requests pr": (binds) => {
          if (binds[5] === "github:pr:merged") {
            return [
              {
                number: 9,
                title: "Merged one",
                author: "bob",
                author_avatar: "b.png",
                event_at: "2026-05-10T08:00:00Z",
                user_id: 2,
                user_type: "User",
                user_name: "Bob",
              },
            ];
          }
          return [];
        },
      },
    });
    const counts = await reconcileRepoEvents({}, db, {
      orgId: 1,
      orgLogin: "o",
      repo: "r",
      lookbackHours: 720,
      includeGithubEvents: false,
    });
    expect(counts.prMerged).toBe(1);
    const insert = db._calls.runs.find((r) => r.sql.includes("INSERT INTO events"));
    expect(insert.binds[0]).toBe("reconcile:o:r:pr-9:merged");
    expect(insert.binds[1]).toBe("github:pr:merged");
    expect(insert.binds[9]).toBe("2026-05-10T08:00:00Z");
  });
});

describe("reconcileRepoEvents — D1 issue backfill", () => {
  it("inserts a github:issue:opened row", async () => {
    const db = makeDb({
      all: {
        "FROM issues i": (binds) => {
          if (binds[5] === "github:issue:opened") {
            return [
              {
                number: 7,
                title: "Bug report",
                author: "carol",
                author_avatar: "c.png",
                state: "open",
                event_at: "2026-05-18T11:00:00Z",
                user_id: 3,
                user_type: "User",
                user_name: "Carol",
              },
            ];
          }
          return [];
        },
      },
    });
    const counts = await reconcileRepoEvents({}, db, {
      orgId: 1,
      orgLogin: "o",
      repo: "r",
      lookbackHours: 720,
      includeGithubEvents: false,
    });
    expect(counts.issueOpened).toBe(1);
    const insert = db._calls.runs.find((r) =>
      r.sql.includes("INSERT INTO events") &&
      r.binds[1] === "github:issue:opened",
    );
    expect(insert.binds[0]).toBe("reconcile:o:r:issue-7:opened");
  });
});

describe("reconcileRepoEvents — GitHub /events backfill", () => {
  // Dynamic timestamp inside any reasonable lookback window. fetchRepoEvents
  // filters by Date.now() − lookbackHours, so hardcoded dates rot the moment
  // they fall outside the window (this bit us on 2026-05-20 with the previous
  // hardcoded 2026-05-19T10:00:00Z literals).
  const recent = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

  it("translates and inserts a PullRequestReviewEvent", async () => {
    const ts = recent();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: "999",
          type: "PullRequestReviewEvent",
          actor: { login: "dan", id: 9, avatar_url: "d.png" },
          payload: {
            action: "submitted",
            review: { state: "approved", body: "lgtm", submitted_at: ts },
            pull_request: { number: 12, title: "wip" },
          },
          created_at: ts,
        },
      ],
    });

    const db = makeDb({
      first: {
        "SELECT id, type FROM gh_users": () => null,
      },
    });

    const counts = await reconcileRepoEvents({}, db, {
      orgId: 1,
      orgLogin: "o",
      repo: "r",
      token: "tok",
      lookbackHours: 24,
    });

    expect(counts.review).toBe(1);
    const insert = db._calls.runs.find((r) =>
      r.sql.includes("INSERT INTO events") &&
      r.binds[1] === "github:pr:review:approved",
    );
    expect(insert.binds[0]).toBe("reconcile:o:r:gh-event-999");
    expect(upsertGhUser).toHaveBeenCalled();
  });

  it("skips PR open/close/merge entries from /events to avoid double-insert", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: "100",
          type: "PullRequestEvent",
          actor: { login: "a", id: 1 },
          payload: { action: "opened", pull_request: { number: 1, title: "x" } },
          created_at: recent(),
        },
      ],
    });
    const db = makeDb();
    const counts = await reconcileRepoEvents({}, db, {
      orgId: 1, orgLogin: "o", repo: "r", token: "tok", lookbackHours: 24,
    });
    expect(counts.review).toBe(0);
    expect(counts.push).toBe(0);
    expect(counts.release).toBe(0);
  });

  it("preserves existing Bot type when gh_user already exists", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: "1",
          type: "PushEvent",
          actor: { login: "renovate[bot]", id: 555 },
          payload: { ref: "refs/heads/main", commits: [] },
          created_at: recent(),
        },
      ],
    });
    const db = makeDb({
      first: {
        "SELECT id, type FROM gh_users": () => ({ id: 555, type: "Bot" }),
      },
    });
    await reconcileRepoEvents({}, db, {
      orgId: 1, orgLogin: "o", repo: "r", token: "tok", lookbackHours: 24,
    });
    // upsertGhUser must NOT be called when user already exists — that's the bot-type-preservation path
    expect(upsertGhUser).not.toHaveBeenCalled();
  });

  it("treats 404/403 from /events as empty (other repos keep going)", async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found" });
    const db = makeDb();
    const counts = await reconcileRepoEvents({}, db, {
      orgId: 1, orgLogin: "o", repo: "r", token: "tok", lookbackHours: 24,
    });
    expect(counts.review).toBe(0);
    expect(counts.push).toBe(0);
  });
});

describe("reconcileRepoEvents — idempotency", () => {
  it("re-running over the same data inserts zero new rows (NOT EXISTS filter)", async () => {
    // Both PR and issue queries return [] (because the NOT EXISTS subquery
    // would short-circuit them in real D1); this models the post-first-run state.
    const db = makeDb({
      all: {
        "FROM pull_requests pr": () => [],
        "FROM issues i": () => [],
      },
    });
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => [] });

    const counts = await reconcileRepoEvents({}, db, {
      orgId: 1, orgLogin: "o", repo: "r", token: "tok", lookbackHours: 24,
    });
    expect(counts).toEqual({
      prOpened: 0, prClosed: 0, prMerged: 0,
      issueOpened: 0, issueClosed: 0,
      review: 0, push: 0, release: 0,
    });
    const inserts = db._calls.runs.filter((r) => r.sql.includes("INSERT INTO events"));
    expect(inserts).toHaveLength(0);
  });
});
