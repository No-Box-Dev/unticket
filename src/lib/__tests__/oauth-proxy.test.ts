import { describe, it, expect, vi, beforeEach } from "vitest";

let getAuthMode: typeof import("../oauth-proxy").getAuthMode;
let getOAuthLoginUrl: typeof import("../oauth-proxy").getOAuthLoginUrl;

beforeEach(() => {
  vi.resetModules();
});

async function loadModule(env: Record<string, string | undefined>) {
  vi.stubEnv("VITE_GITHUB_APP_CLIENT_ID", env.VITE_GITHUB_APP_CLIENT_ID ?? "");
  vi.stubEnv("VITE_OAUTH_PROXY_URL", env.VITE_OAUTH_PROXY_URL ?? "");

  const mod = await import("../oauth-proxy");
  getAuthMode = mod.getAuthMode;
  getOAuthLoginUrl = mod.getOAuthLoginUrl;
}

describe("getAuthMode", () => {
  it("returns 'oauth' when CLIENT_ID is set", async () => {
    await loadModule({ VITE_GITHUB_APP_CLIENT_ID: "abc123" });
    expect(getAuthMode()).toBe("oauth");
  });

  it("returns 'pat' when CLIENT_ID is not set", async () => {
    await loadModule({ VITE_GITHUB_APP_CLIENT_ID: undefined });
    expect(getAuthMode()).toBe("pat");
  });
});

describe("getOAuthLoginUrl", () => {
  it("without proxy, uses /api/auth/callback redirect", async () => {
    await loadModule({
      VITE_GITHUB_APP_CLIENT_ID: "client1",
      VITE_OAUTH_PROXY_URL: undefined,
    });
    const url = getOAuthLoginUrl();
    expect(url).toContain("client_id=client1");
    expect(url).toContain(encodeURIComponent(`${window.location.origin}/api/auth/callback`));
    expect(url).toContain("github.com/login/oauth/authorize");
  });

  it("with proxy, uses proxy redirect with encoded origin", async () => {
    await loadModule({
      VITE_GITHUB_APP_CLIENT_ID: "client2",
      VITE_OAUTH_PROXY_URL: "https://proxy.example.com/callback",
    });
    const url = getOAuthLoginUrl();
    expect(url).toContain("client_id=client2");
    expect(url).toContain(encodeURIComponent(
      `https://proxy.example.com/callback?redirect=${encodeURIComponent(window.location.origin)}`,
    ));
  });

  it("does not include OAuth-App scope param (GitHub Apps reject it)", async () => {
    await loadModule({ VITE_GITHUB_APP_CLIENT_ID: "client3" });
    const url = getOAuthLoginUrl();
    expect(url).not.toContain("scope=");
  });
});
