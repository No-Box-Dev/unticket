import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "../auth";

// Mock dependencies
vi.mock("@/lib/github", () => ({
  fetchUser: vi.fn(),
  resetOctokit: vi.fn(),
}));

vi.mock("@/lib/oauth-proxy", () => ({
  getAuthMode: vi.fn().mockReturnValue("oauth"),
  getOAuthLoginUrl: vi.fn().mockReturnValue("https://github.com/login/oauth"),
}));

import { fetchUser, resetOctokit } from "@/lib/github";
import { getAuthMode } from "@/lib/oauth-proxy";

const mockFetchUser = vi.mocked(fetchUser);
const mockResetOctokit = vi.mocked(resetOctokit);
const mockGetAuthMode = vi.mocked(getAuthMode);

let storage: Record<string, string> = {};

function TestConsumer() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(auth.isLoading)}</span>
      <span data-testid="user">{auth.user?.login ?? "none"}</span>
      <span data-testid="org">{auth.selectedOrg ?? "none"}</span>
      <span data-testid="mode">{auth.authMode}</span>
      <button onClick={() => auth.loginWithToken("new-tok")}>loginWithToken</button>
      <button onClick={auth.logout}>logout</button>
      <button onClick={() => auth.setSelectedOrg("test-org")}>setOrg</button>
    </div>
  );
}

// Save originals
const originalLocation = window.location;
const originalReplaceState = window.history.replaceState;

beforeEach(() => {
  vi.clearAllMocks();
  storage = {};

  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, val: string) => { storage[key] = val; },
    removeItem: (key: string) => { delete storage[key]; },
  });

  // Default location — no query params
  Object.defineProperty(window, "location", {
    value: {
      origin: "http://localhost",
      pathname: "/",
      search: "",
      href: "http://localhost/",
    },
    writable: true,
    configurable: true,
  });
  window.history.replaceState = vi.fn();

  mockGetAuthMode.mockReturnValue("oauth");

  // By default, import.meta.env has no dev token
  vi.stubEnv("VITE_DEV_TOKEN", "");
  vi.stubEnv("VITE_DEV_ORG", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
    configurable: true,
  });
  window.history.replaceState = originalReplaceState;
});

describe("useAuth", () => {
  it("throws outside AuthProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow(
      "useAuth must be used within AuthProvider",
    );
    spy.mockRestore();
  });

  it("isLoading starts true, becomes false", async () => {
    storage.gp_token = "tok";
    mockFetchUser.mockResolvedValue({ login: "alice", avatar_url: "", name: null });

    render(
      <AuthProvider><TestConsumer /></AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
  });

  it("loads user from existing gp_token in localStorage", async () => {
    storage.gp_token = "tok";
    mockFetchUser.mockResolvedValue({ login: "alice", avatar_url: "", name: "Alice" });

    render(
      <AuthProvider><TestConsumer /></AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("user").textContent).toBe("alice");
    });
  });

  it("no user when no token", async () => {
    render(
      <AuthProvider><TestConsumer /></AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("user").textContent).toBe("none");
  });

  it("OAuth callback: extracts token from URL, stores, fetches user", async () => {
    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost",
        pathname: "/",
        search: "?token=oauth-tok-123",
        href: "http://localhost/?token=oauth-tok-123",
      },
      writable: true,
      configurable: true,
    });
    mockFetchUser.mockResolvedValue({ login: "oauth-user", avatar_url: "", name: null });

    render(
      <AuthProvider><TestConsumer /></AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("user").textContent).toBe("oauth-user");
    });
    expect(storage.gp_token).toBe("oauth-tok-123");
    expect(window.history.replaceState).toHaveBeenCalled();
  });

  it("loginWithToken: stores token, resets octokit, sets user", async () => {
    mockFetchUser.mockResolvedValue({ login: "bob", avatar_url: "", name: null });

    render(
      <AuthProvider><TestConsumer /></AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    await act(async () => {
      screen.getByText("loginWithToken").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("user").textContent).toBe("bob");
    });
    expect(storage.gp_token).toBe("new-tok");
    expect(mockResetOctokit).toHaveBeenCalled();
  });

  it("logout: clears localStorage, resets user + org", async () => {
    storage.gp_token = "tok";
    storage.gp_org = "org1";
    mockFetchUser.mockResolvedValue({ login: "alice", avatar_url: "", name: null });

    render(
      <AuthProvider><TestConsumer /></AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("user").textContent).toBe("alice");
    });

    await act(async () => {
      screen.getByText("logout").click();
    });

    expect(screen.getByTestId("user").textContent).toBe("none");
    expect(screen.getByTestId("org").textContent).toBe("none");
    expect(storage.gp_token).toBeUndefined();
    expect(storage.gp_org).toBeUndefined();
  });

  it("setSelectedOrg persists to localStorage", async () => {
    render(
      <AuthProvider><TestConsumer /></AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    await act(async () => {
      screen.getByText("setOrg").click();
    });

    expect(screen.getByTestId("org").textContent).toBe("test-org");
    expect(storage.gp_org).toBe("test-org");
  });

  it("authMode reflects getAuthMode()", async () => {
    mockGetAuthMode.mockReturnValue("pat");

    render(
      <AuthProvider><TestConsumer /></AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("mode").textContent).toBe("pat");
    });
  });
});
