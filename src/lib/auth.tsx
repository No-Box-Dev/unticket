/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { fetchUser, resetOctokit } from "@/lib/github";
import { getOAuthLoginUrl } from "@/lib/oauth-proxy";
import { broadcastError } from "@/lib/api";

// Mirror the localStorage token into a cookie so the /specs-content/* proxy
// can authenticate browser-initiated sub-resource loads (images, scripts,
// stylesheets inside a rendered HTML spec). The cookie holds the same token
// localStorage holds — same security level, no new attack surface. Path=/
// so all assets under /specs-content/ pick it up; Lax+Secure standard.
function setSessionCookie(token: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `ut_session=${encodeURIComponent(token)}; Path=/; Max-Age=86400; SameSite=Lax; Secure`;
}
function clearSessionCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = "ut_session=; Path=/; Max-Age=0; SameSite=Lax; Secure";
}

interface User {
  login: string;
  avatar_url: string;
  name: string | null;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  authError: string | null;
  loginWithOAuth: () => void;
  logout: () => void;
  selectedOrg: string | null;
  setSelectedOrg: (org: string | null) => void;
}

const AUTH_TIMEOUT_MS = 10_000;

function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    const status = (err as any).status as number | undefined;
    if (status === 403 || status === 429) return true;
    if (err.message.toLowerCase().includes("rate limit")) return true;
  }
  return false;
}

/** Exchange a one-time auth code for a GitHub access token. */
async function exchangeAuthCode(code: string): Promise<string> {
  const res = await fetch("/api/auth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Exchange failed" }));
    throw new Error((body as { error?: string }).error ?? "Token exchange failed");
  }
  const data = await res.json();
  return data.token;
}

/** Race fetchUser against a timeout so the app never hangs on a bad token. */
function fetchUserWithTimeout(): Promise<User> {
  return Promise.race([
    fetchUser(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Auth timeout")), AUTH_TIMEOUT_MS),
    ),
  ]) as Promise<User>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(
    localStorage.getItem("ut_org"),
  );

  // Listen for force-logout events (fired by api.ts on 401)
  useEffect(() => {
    const handler = () => {
      resetOctokit();
      localStorage.removeItem("ut_org");
      clearSessionCookie();
      setUser(null);
      setSelectedOrg(null);
    };
    window.addEventListener("ut:force-logout", handler);
    return () => window.removeEventListener("ut:force-logout", handler);
  }, []);

  // Cross-tab logout: react when another tab removes ut_token from localStorage
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "ut_token" && e.newValue === null && user) {
        resetOctokit();
        clearSessionCookie();
        setUser(null);
        setSelectedOrg(null);
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [user]);

  useEffect(() => {
    // Check for OAuth callback exchange code in URL query params
    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get("auth_code");
    if (authCode) {
      window.history.replaceState({}, "", window.location.pathname);
      // Exchange the one-time code for a token via server endpoint
      exchangeAuthCode(authCode)
        .then((token) => {
          localStorage.setItem("ut_token", token);
          setSessionCookie(token);
          resetOctokit();
          return fetchUserWithTimeout();
        })
        .then(setUser)
        .catch((err) => {
          if (isRateLimitError(err)) {
            setAuthError("GitHub API rate limit exceeded. Please wait a few minutes and refresh.");
          } else {
            const msg = err instanceof Error ? err.message : "Authentication failed";
            setAuthError(msg);
            broadcastError(msg);
            localStorage.removeItem("ut_token");
            resetOctokit();
          }
        })
        .finally(() => setIsLoading(false));
      return;
    }

    // Dev mode: auto-inject token and org from env vars (only in dev builds)
    if (import.meta.env.DEV) {
      const devToken = import.meta.env.VITE_DEV_TOKEN;
      if (devToken) {
        localStorage.setItem("ut_token", devToken);
        resetOctokit();
      }
      const devOrg = import.meta.env.VITE_DEV_ORG;
      if (devOrg) {
        localStorage.setItem("ut_org", devOrg);
        // Intentional: one-shot dev-only injection during initial mount.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedOrg(devOrg);
      }
    }

    const token = localStorage.getItem("ut_token");
    if (token) {
      // Keep cookie in sync for users whose session predates the proxy.
      setSessionCookie(token);
      resetOctokit();
      fetchUserWithTimeout()
        .then(setUser)
        .catch((err) => {
          if (isRateLimitError(err)) {
            setAuthError("GitHub API rate limit exceeded. Please wait a few minutes and refresh.");
          } else {
            broadcastError(err instanceof Error ? err.message : "Authentication failed");
            localStorage.removeItem("ut_token");
            clearSessionCookie();
            resetOctokit();
          }
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const loginWithOAuth = () => {
    // Clear stale token/instance before redirecting so we start fresh
    localStorage.removeItem("ut_token");
    clearSessionCookie();
    resetOctokit();
    window.location.href = getOAuthLoginUrl();
  };

  const logout = () => {
    localStorage.removeItem("ut_token");
    localStorage.removeItem("ut_org");
    clearSessionCookie();
    resetOctokit();
    setUser(null);
    setSelectedOrg(null);
  };

  const handleSetOrg = (org: string | null) => {
    setSelectedOrg(org);
    if (org) localStorage.setItem("ut_org", org);
    else localStorage.removeItem("ut_org");
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        authError,
        loginWithOAuth,
        logout,
        selectedOrg,
        setSelectedOrg: handleSetOrg,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
