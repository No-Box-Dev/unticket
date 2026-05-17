import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  upsertGhUser,
  upsertInstallation,
  setInstallationRepos,
  getInstallationRepos,
} from "../gh-mirror.js";

function makeDb({ installationRow = null } = {}) {
  const calls = { firsts: [], runs: [] };
  function prepare(sql) {
    return {
      _sql: sql,
      _binds: [],
      bind(...binds) { this._binds = binds; return this; },
      async first() {
        calls.firsts.push({ sql, binds: this._binds });
        if (sql.includes("FROM installations")) return installationRow;
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

describe("upsertGhUser", () => {
  it("no-ops when user is null or missing id/login", async () => {
    const db = makeDb();
    await upsertGhUser(db, null);
    await upsertGhUser(db, { id: 1 });
    await upsertGhUser(db, { login: "x" });
    expect(db._calls.runs).toHaveLength(0);
  });

  it("inserts with defaults for missing fields", async () => {
    const db = makeDb();
    await upsertGhUser(db, { id: 1, login: "octocat" });
    expect(db._calls.runs).toHaveLength(1);
    const [id, login, avatar, type, name] = db._calls.runs[0].binds;
    expect(id).toBe(1);
    expect(login).toBe("octocat");
    expect(avatar).toBeNull();
    expect(type).toBe("User");
    expect(name).toBeNull();
  });

  it("passes through all fields when provided", async () => {
    const db = makeDb();
    await upsertGhUser(db, {
      id: 99,
      login: "dependabot[bot]",
      avatar_url: "https://example.com/d.png",
      type: "Bot",
      name: "Dependabot",
    });
    expect(db._calls.runs[0].binds).toEqual([
      99, "dependabot[bot]", "https://example.com/d.png", "Bot", "Dependabot",
    ]);
  });

  it("uses ON CONFLICT DO UPDATE syntax", async () => {
    const db = makeDb();
    await upsertGhUser(db, { id: 1, login: "x" });
    expect(db._calls.runs[0].sql).toMatch(/ON CONFLICT/i);
  });
});

describe("upsertInstallation", () => {
  it("no-ops when installation is missing id or account.login", async () => {
    const db = makeDb();
    await upsertInstallation(db, null);
    await upsertInstallation(db, { id: 1 });
    await upsertInstallation(db, { id: 1, account: {} });
    expect(db._calls.runs).toHaveLength(0);
  });

  it("inserts with default account_type when not provided", async () => {
    const db = makeDb();
    await upsertInstallation(db, { id: 12, account: { login: "no-box-dev" } });
    expect(db._calls.runs[0].binds[3]).toBe("Organization");
  });

  it("passes account_type through when provided", async () => {
    const db = makeDb();
    await upsertInstallation(db, {
      id: 12,
      account: { login: "jasper", type: "User" },
    });
    expect(db._calls.runs[0].binds[3]).toBe("User");
  });

  it("uses owner_id = account_login (intentional — owner key is the login)", async () => {
    const db = makeDb();
    await upsertInstallation(db, { id: 12, account: { login: "no-box-dev" } });
    const [instId, ownerId, accountLogin] = db._calls.runs[0].binds;
    expect(instId).toBe(12);
    expect(ownerId).toBe("no-box-dev");
    expect(accountLogin).toBe("no-box-dev");
  });

  it("passes reposJson through (null by default)", async () => {
    const db = makeDb();
    await upsertInstallation(db, { id: 12, account: { login: "x" } });
    expect(db._calls.runs[0].binds[4]).toBeNull();

    await upsertInstallation(db, { id: 12, account: { login: "x" } }, '["a/b"]');
    expect(db._calls.runs[1].binds[4]).toBe('["a/b"]');
  });

  it("ON CONFLICT preserves repos_json via COALESCE", async () => {
    const db = makeDb();
    await upsertInstallation(db, { id: 12, account: { login: "x" } });
    expect(db._calls.runs[0].sql).toMatch(/COALESCE\(excluded\.repos_json/);
  });
});

describe("setInstallationRepos", () => {
  it("no-ops when installationId is missing", async () => {
    const db = makeDb();
    await setInstallationRepos(db, null, ["a/b"]);
    expect(db._calls.runs).toHaveLength(0);
  });

  it("serializes the repo list to JSON and binds it", async () => {
    const db = makeDb();
    await setInstallationRepos(db, 12, ["a/b", "c/d"]);
    expect(db._calls.runs).toHaveLength(1);
    expect(JSON.parse(db._calls.runs[0].binds[0])).toEqual(["a/b", "c/d"]);
  });

  it("filters out invalid entries (non-string, no slash)", async () => {
    const db = makeDb();
    await setInstallationRepos(db, 12, ["a/b", null, "no-slash", 42, "c/d"]);
    expect(JSON.parse(db._calls.runs[0].binds[0])).toEqual(["a/b", "c/d"]);
  });

  it("writes [] when fullNames is not an array", async () => {
    const db = makeDb();
    await setInstallationRepos(db, 12, "not array");
    expect(JSON.parse(db._calls.runs[0].binds[0])).toEqual([]);
  });
});

describe("getInstallationRepos", () => {
  it("returns [] when installationId is missing", async () => {
    const db = makeDb();
    expect(await getInstallationRepos(db, null)).toEqual([]);
    expect(db._calls.firsts).toHaveLength(0);
  });

  it("returns [] when no row found", async () => {
    expect(await getInstallationRepos(makeDb(), 12)).toEqual([]);
  });

  it("returns [] when repos_json is null", async () => {
    const db = makeDb({ installationRow: { repos_json: null } });
    expect(await getInstallationRepos(db, 12)).toEqual([]);
  });

  it("parses + returns the repos list", async () => {
    const db = makeDb({ installationRow: { repos_json: '["a/b","c/d"]' } });
    expect(await getInstallationRepos(db, 12)).toEqual(["a/b", "c/d"]);
  });

  it("filters out non-string array entries", async () => {
    const db = makeDb({ installationRow: { repos_json: '["a/b",null,42,"c/d"]' } });
    expect(await getInstallationRepos(db, 12)).toEqual(["a/b", "c/d"]);
  });

  it("logs + returns [] on corrupt JSON (does not throw)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = makeDb({ installationRow: { repos_json: "not json" } });
    expect(await getInstallationRepos(db, 12)).toEqual([]);
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining("Corrupt repos_json for installation 12"),
      expect.anything(),
    );
    err.mockRestore();
  });

  it("returns [] when repos_json parses to non-array", async () => {
    const db = makeDb({ installationRow: { repos_json: '{"not": "array"}' } });
    expect(await getInstallationRepos(db, 12)).toEqual([]);
  });
});

beforeEach(() => {});
afterEach(() => vi.restoreAllMocks());
