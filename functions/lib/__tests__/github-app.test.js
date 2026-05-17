import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We re-import the module in each test where cache state matters via
// vi.resetModules() so the installation token cache starts clean.

const PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
${"A".repeat(64)}
${"A".repeat(64)}
-----END PRIVATE KEY-----`;

// Web Crypto SubtleCrypto is provided by Node 20+ in vitest, but signing
// requires a real PKCS8 key. We mock crypto.subtle so we don't need to
// generate a real key just to test the function shape.
function stubCrypto() {
  vi.stubGlobal("crypto", {
    subtle: {
      importKey: vi.fn(async () => ({ __key: true })),
      sign: vi.fn(async () => new ArrayBuffer(8)),
    },
  });
}

beforeEach(() => {
  stubCrypto();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("signAppJwt", () => {
  it("throws when GITHUB_APP_ID is missing", async () => {
    const { signAppJwt } = await import("../github-app.js");
    await expect(signAppJwt({ GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY_PEM })).rejects.toThrow(
      /GITHUB_APP_ID|GITHUB_APP_PRIVATE_KEY/,
    );
  });

  it("throws when GITHUB_APP_PRIVATE_KEY is missing", async () => {
    const { signAppJwt } = await import("../github-app.js");
    await expect(signAppJwt({ GITHUB_APP_ID: "123" })).rejects.toThrow(
      /GITHUB_APP_ID|GITHUB_APP_PRIVATE_KEY/,
    );
  });

  it("produces a three-part JWT", async () => {
    const { signAppJwt } = await import("../github-app.js");
    const jwt = await signAppJwt({
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY_PEM,
    });
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
  });

  it("sets iss to the App ID and exp ~9 minutes out", async () => {
    const { signAppJwt } = await import("../github-app.js");
    const before = Math.floor(Date.now() / 1000);
    const jwt = await signAppJwt({
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY_PEM,
    });
    const [, payloadB64] = jwt.split(".");
    // base64url -> base64
    const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - payloadB64.length % 4) % 4);
    const payload = JSON.parse(atob(padded));
    expect(payload.iss).toBe("12345");
    expect(payload.exp - payload.iat).toBeGreaterThan(8 * 60);
    expect(payload.exp - payload.iat).toBeLessThan(10 * 60);
    // iat ~ now - 30
    expect(payload.iat).toBeLessThanOrEqual(before);
    expect(payload.iat).toBeGreaterThanOrEqual(before - 60);
  });

  it("uses RS256 alg in the header", async () => {
    const { signAppJwt } = await import("../github-app.js");
    const jwt = await signAppJwt({
      GITHUB_APP_ID: "1",
      GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY_PEM,
    });
    const [headerB64] = jwt.split(".");
    const padded = headerB64.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - headerB64.length % 4) % 4);
    const header = JSON.parse(atob(padded));
    expect(header.alg).toBe("RS256");
    expect(header.typ).toBe("JWT");
  });
});

describe("getInstallationToken", () => {
  const ENV = {
    GITHUB_APP_ID: "12345",
    GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY_PEM,
  };

  it("throws when installationId is missing", async () => {
    const { getInstallationToken } = await import("../github-app.js");
    await expect(getInstallationToken(ENV, null)).rejects.toThrow(/installationId/);
  });

  it("POSTs to the installation access_tokens endpoint with a Bearer JWT", async () => {
    const { getInstallationToken } = await import("../github-app.js");
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        token: "ghs_abc",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }),
    });
    const token = await getInstallationToken(ENV, 999);
    expect(token).toBe("ghs_abc");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.github.com/app/installations/999/access_tokens");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toMatch(/^Bearer /);
    expect(init.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("throws on non-2xx GitHub responses", async () => {
    const { getInstallationToken } = await import("../github-app.js");
    fetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Bad credentials",
    });
    await expect(getInstallationToken(ENV, 1)).rejects.toThrow(
      /Failed to mint.*401.*Bad credentials/,
    );
  });

  it("caches tokens with >5min remaining lifetime", async () => {
    const { getInstallationToken } = await import("../github-app.js");
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        token: "ghs_first",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    const t1 = await getInstallationToken(ENV, 7);
    const t2 = await getInstallationToken(ENV, 7);
    expect(t1).toBe("ghs_first");
    expect(t2).toBe("ghs_first");
    // The second call hit the cache: only one fetch.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("re-mints when the cached token has <5min left", async () => {
    const { getInstallationToken } = await import("../github-app.js");
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "ghs_short",
          // Cached entry will only have 1 minute left.
          expires_at: new Date(Date.now() + 60 * 1000).toISOString(),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "ghs_fresh",
          expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        }),
      });
    expect(await getInstallationToken(ENV, 8)).toBe("ghs_short");
    expect(await getInstallationToken(ENV, 8)).toBe("ghs_fresh");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("truncates GitHub error message to 200 chars", async () => {
    const { getInstallationToken } = await import("../github-app.js");
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "x".repeat(500),
    });
    try {
      await getInstallationToken(ENV, 1);
    } catch (e) {
      // 500 status + " (500): " + 200 chars of body
      expect(e.message.length).toBeLessThan(260);
      expect(e.message).toContain("500");
    }
  });
});

describe("getInstallationIdForOrg", () => {
  it("returns the installation_id for the org row", async () => {
    const { getInstallationIdForOrg } = await import("../github-app.js");
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({ installation_id: 42 }),
        }),
      }),
    };
    expect(await getInstallationIdForOrg(db, "org-1")).toBe(42);
  });

  it("returns null when the org row is missing", async () => {
    const { getInstallationIdForOrg } = await import("../github-app.js");
    const db = {
      prepare: () => ({
        bind: () => ({ first: async () => null }),
      }),
    };
    expect(await getInstallationIdForOrg(db, "missing")).toBeNull();
  });

  it("returns null when row has no installation_id", async () => {
    const { getInstallationIdForOrg } = await import("../github-app.js");
    const db = {
      prepare: () => ({
        bind: () => ({ first: async () => ({}) }),
      }),
    };
    expect(await getInstallationIdForOrg(db, "x")).toBeNull();
  });
});
