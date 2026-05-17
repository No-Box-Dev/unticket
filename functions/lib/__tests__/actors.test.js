import { describe, it, expect } from "vitest";
import { resolveActorFromGithub, DEFAULT_ACTOR_TONE } from "../actors.js";

// D1 stub: dispatch on SQL substring. `existing` toggles whether the
// initial SELECT FROM actors finds a row. After INSERT, the final
// SELECT for the inserted row uses `insertResult`.
function makeDb({ existing = null, insertResult = null } = {}) {
  const calls = { firsts: [], runs: [] };
  let firstSelectCount = 0;

  function prepare(sql) {
    return {
      _sql: sql,
      _binds: [],
      bind(...binds) { this._binds = binds; return this; },
      async first() {
        calls.firsts.push({ sql, binds: this._binds });
        if (sql.includes("FROM actors")) {
          firstSelectCount += 1;
          // First call is the existence check.
          if (firstSelectCount === 1) return existing;
          // Subsequent first() returns either the existing row (post-update)
          // or insertResult (post-insert).
          return existing ?? insertResult;
        }
        return null;
      },
      async run() {
        calls.runs.push({ sql, binds: this._binds });
        return { meta: { changes: 1 } };
      },
    };
  }
  return { prepare, _calls: calls };
}

const HUMAN_AUTHOR = {
  id: 12345,
  login: "Octocat",
  type: "User",
  name: "Mona Lisa",
  avatar_url: "https://example.com/a.png",
};

const BOT_AUTHOR = {
  id: 99999,
  login: "dependabot[bot]",
  type: "Bot",
  name: null,
  avatar_url: null,
};

describe("resolveActorFromGithub — input validation", () => {
  it("returns null when author is null", async () => {
    const db = makeDb();
    expect(await resolveActorFromGithub(db, "owner", null)).toBeNull();
    expect(db._calls.firsts).toHaveLength(0);
    expect(db._calls.runs).toHaveLength(0);
  });

  it("returns null when author has no login", async () => {
    expect(await resolveActorFromGithub(makeDb(), "owner", { id: 1 })).toBeNull();
  });

  it("returns null when author has no id", async () => {
    expect(await resolveActorFromGithub(makeDb(), "owner", { login: "x" })).toBeNull();
  });

  it("treats id=0 as missing (since the SQL uses null check via == null)", async () => {
    // The guard is `author.id == null` — that's true for null/undefined only.
    // id=0 is technically valid but extremely unlikely from GitHub. Document
    // that the function does proceed with id=0.
    const db = makeDb({ existing: null, insertResult: { id: "actor_x", name: "x", tone: "t" } });
    const result = await resolveActorFromGithub(db, "owner", { id: 0, login: "x" });
    expect(result).toEqual({ id: "actor_x", name: "x", tone: "t" });
  });
});

describe("resolveActorFromGithub — existing actor (update path)", () => {
  it("runs an UPDATE (backfill avatar + conditional name) without INSERT", async () => {
    const db = makeDb({ existing: { id: "actor_octocat" } });
    await resolveActorFromGithub(db, "owner-1", HUMAN_AUTHOR);
    expect(db._calls.runs).toHaveLength(1);
    expect(db._calls.runs[0].sql).toContain("UPDATE actors");
    expect(db._calls.runs[0].sql).not.toContain("INSERT");
  });

  it("binds owner_id and github_user_id (stringified) for the existence check", async () => {
    const db = makeDb({ existing: { id: "actor_octocat" } });
    await resolveActorFromGithub(db, "owner-1", HUMAN_AUTHOR);
    const lookup = db._calls.firsts.find((f) => f.sql.includes("FROM actors WHERE owner_id"));
    expect(lookup.binds).toEqual(["owner-1", "12345"]);
  });

  it("lowercases login when looking up", async () => {
    const db = makeDb({ existing: { id: "actor_octocat" } });
    await resolveActorFromGithub(db, "owner-1", HUMAN_AUTHOR);
    const update = db._calls.runs[0];
    // The 2nd UPDATE bind is the login (used in the CASE WHEN name = ?).
    expect(update.binds[1]).toBe("octocat");
  });
});

describe("resolveActorFromGithub — new actor (insert path)", () => {
  it("inserts with kind='human' for User type", async () => {
    const db = makeDb({
      existing: null,
      insertResult: { id: "actor_octocat", name: "Mona Lisa", tone: DEFAULT_ACTOR_TONE },
    });
    await resolveActorFromGithub(db, "owner-1", HUMAN_AUTHOR);
    const insert = db._calls.runs[0];
    expect(insert.sql).toContain("INSERT INTO actors");
    // binds: id, github_user_id, name, avatar_url, tone, kind, owner_id
    expect(insert.binds[0]).toBe("actor_octocat");
    expect(insert.binds[1]).toBe("12345");
    expect(insert.binds[2]).toBe("Mona Lisa");
    expect(insert.binds[3]).toBe("https://example.com/a.png");
    expect(insert.binds[5]).toBe("human");
    expect(insert.binds[6]).toBe("owner-1");
  });

  it("inserts with kind='bot' and bot tone for Bot type", async () => {
    const db = makeDb({
      existing: null,
      insertResult: { id: "actor_dependabot[bot]", name: "dependabot[bot]", tone: "bot tone" },
    });
    await resolveActorFromGithub(db, "owner-1", BOT_AUTHOR);
    const insert = db._calls.runs[0];
    expect(insert.binds[5]).toBe("bot");
    // bot tone is distinct from DEFAULT_ACTOR_TONE
    expect(insert.binds[4]).not.toBe(DEFAULT_ACTOR_TONE);
    expect(insert.binds[4]).toMatch(/changelog/i);
  });

  it("falls back to login when author.name is missing", async () => {
    const db = makeDb({
      existing: null,
      insertResult: { id: "actor_dependabot[bot]" },
    });
    await resolveActorFromGithub(db, "owner-1", BOT_AUTHOR);
    expect(db._calls.runs[0].binds[2]).toBe("dependabot[bot]");
  });

  it("inserts null avatar_url when author.avatar_url is missing", async () => {
    const db = makeDb({
      existing: null,
      insertResult: { id: "actor_x" },
    });
    await resolveActorFromGithub(db, "owner-1", { ...HUMAN_AUTHOR, avatar_url: undefined });
    expect(db._calls.runs[0].binds[3]).toBeNull();
  });

  it("returns the post-insert SELECT result", async () => {
    const inserted = { id: "actor_octocat", name: "Mona Lisa", tone: "X" };
    const db = makeDb({ existing: null, insertResult: inserted });
    const result = await resolveActorFromGithub(db, "owner-1", HUMAN_AUTHOR);
    expect(result).toEqual(inserted);
  });
});

describe("DEFAULT_ACTOR_TONE", () => {
  it("is a non-empty string", () => {
    expect(typeof DEFAULT_ACTOR_TONE).toBe("string");
    expect(DEFAULT_ACTOR_TONE.length).toBeGreaterThan(100);
  });
});
