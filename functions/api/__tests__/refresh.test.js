import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { onRequestPost } from "../auth/refresh.js";
import { encryptToken } from "../../lib/crypto.js";
import { hashAccessToken } from "../../lib/oauth-tokens.js";

const KEY = "0".repeat(64); // 32 bytes zeroed — only used inside tests

function makeDb() {
  const rows = new Map(); // hash → row

  const prepare = (sql) => {
    return {
      bind: (...args) => ({
        first: async () => {
          if (sql.includes("FROM oauth_tokens") && sql.includes("WHERE access_token_sha256 = ?")) {
            return rows.get(args[0]) ?? null;
          }
          return null;
        },
        run: async () => {
          if (sql.startsWith("DELETE FROM oauth_tokens")) {
            rows.delete(args[0]);
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE oauth_tokens")) {
            const [newHash, refreshed, accessExp, refreshExp, oldHash] = args;
            const row = rows.get(oldHash);
            if (!row) return { meta: { changes: 0 } };
            rows.delete(oldHash);
            rows.set(newHash, {
              ...row,
              access_token_sha256: newHash,
              encrypted_refresh_token: refreshed ?? row.encrypted_refresh_token,
              access_token_expires_at: accessExp,
              refresh_token_expires_at: refreshExp ?? row.refresh_token_expires_at,
            });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("INSERT INTO oauth_tokens")) {
            const [newHash, login, refreshed, accessExp, refreshExp] = args;
            rows.set(newHash, {
              id: rows.size + 1,
              access_token_sha256: newHash,
              github_login: login,
              encrypted_refresh_token: refreshed,
              access_token_expires_at: accessExp,
              refresh_token_expires_at: refreshExp,
            });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
      }),
    };
  };

  return { prepare, _rows: rows };
}

async function seedRow(db, { accessToken, refreshToken, login = "alice", refreshExpiresAt = null }) {
  const hash = await hashAccessToken(accessToken);
  const encrypted = await encryptToken(refreshToken, KEY);
  db._rows.set(hash, {
    id: 1,
    access_token_sha256: hash,
    github_login: login,
    encrypted_refresh_token: encrypted,
    refresh_token_expires_at: refreshExpiresAt,
  });
  return hash;
}

function makeCtx(db, body = { token: "expired-access" }) {
  return {
    request: new Request("http://x/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env: {
      DB: db,
      ENCRYPTION_KEY: KEY,
      GITHUB_APP_CLIENT_ID: "cid",
      GITHUB_APP_CLIENT_SECRET: "csecret",
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/auth/refresh", () => {
  it("400s on missing token", async () => {
    const db = makeDb();
    const res = await onRequestPost(makeCtx(db, {}));
    expect(res.status).toBe(400);
  });

  it("401s when the access token is unknown", async () => {
    const db = makeDb();
    const res = await onRequestPost(makeCtx(db, { token: "ghost" }));
    expect(res.status).toBe(401);
  });

  it("rotates and returns a new access token on success", async () => {
    const db = makeDb();
    const oldHash = await seedRow(db, {
      accessToken: "expired-access",
      refreshToken: "rt-1",
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "new-access",
          refresh_token: "rt-2",
          expires_in: 28800,
          refresh_token_expires_in: 15897600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const res = await onRequestPost(makeCtx(db));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe("new-access");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toBe("https://github.com/login/oauth/access_token");
    const sentBody = JSON.parse(call[1].body);
    expect(sentBody.grant_type).toBe("refresh_token");
    expect(sentBody.refresh_token).toBe("rt-1");

    // Row should have moved to the hash of the new token
    const newHash = await hashAccessToken("new-access");
    expect(db._rows.has(oldHash)).toBe(false);
    expect(db._rows.has(newHash)).toBe(true);
  });

  it("401s and deletes the row when GitHub rejects the refresh token", async () => {
    const db = makeDb();
    const hash = await seedRow(db, {
      accessToken: "expired-access",
      refreshToken: "rt-bad",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "bad_refresh_token", error_description: "Token is invalid" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const res = await onRequestPost(makeCtx(db));
    expect(res.status).toBe(401);
    expect(db._rows.has(hash)).toBe(false);
  });

  it("returns 503 on transport errors so the client can retry", async () => {
    const db = makeDb();
    const hash = await seedRow(db, {
      accessToken: "expired-access",
      refreshToken: "rt-1",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Bad Gateway", { status: 502 }),
    );

    const res = await onRequestPost(makeCtx(db));
    expect(res.status).toBe(503);
    // Row preserved — transient error, client should try again.
    expect(db._rows.has(hash)).toBe(true);
  });

  it("401s and clears the row when the refresh token's TTL has expired", async () => {
    const db = makeDb();
    const past = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const hash = await seedRow(db, {
      accessToken: "expired-access",
      refreshToken: "rt-expired",
      refreshExpiresAt: past,
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await onRequestPost(makeCtx(db));
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db._rows.has(hash)).toBe(false);
  });
});
