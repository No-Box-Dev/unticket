/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { fetchUser, resetOctokit } from "@/lib/github";
import { getAuthMode, getOAuthLoginUrl } from "@/lib/oauth-proxy";
import { broadcastError } from "@/lib/api";

interface User {
  login: string;
  avatar_url: string;
  name: string | null;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  authError: string | null;
  authMode: "oauth" | "pat";
  loginWithToken: (token: string) => Promise<void>;
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
  const authMode = getAuthMode();

  // Listen for force-logout events (fired by api.ts on 401)
  useEffect(() => {
    const handler = () => {
      resetOctokit();
      localStorage.removeItem("ut_org");
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
        setSelectedOrg(devOrg);
      }
    }

    const token = localStorage.getItem("ut_token");
    if (token) {
      resetOctokit();
      fetchUserWithTimeout()
        .then(setUser)
        .catch((err) => {
          if (isRateLimitError(err)) {
            setAuthError("GitHub API rate limit exceeded. Please wait a few minutes and refresh.");
          } else {
            broadcastError(err instanceof Error ? err.message : "Authentication failed");
            localStorage.removeItem("ut_token");
            resetOctokit();
          }
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const loginWithToken = async (token: string) => {
    setIsLoading(true);
    setAuthError(null);
    try {
      localStorage.setItem("ut_token", token);
      resetOctokit();
      const userData = await fetchUserWithTimeout();
      setUser(userData);
    } catch (err) {
      localStorage.removeItem("ut_token");
      resetOctokit();
      const msg = err instanceof Error ? err.message : "Authentication failed";
      setAuthError(msg);
      broadcastError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithOAuth = () => {
    // Clear stale token/instance before redirecting so we start fresh
    localStorage.removeItem("ut_token");
    resetOctokit();
    window.location.href = getOAuthLoginUrl();
  };

  const logout = () => {
    localStorage.removeItem("ut_token");
    localStorage.removeItem("ut_org");
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
        authMode,
        loginWithToken,
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
