import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { fetchUser, resetOctokit } from "@/lib/github";
import { getAuthMode, getOAuthLoginUrl } from "@/lib/oauth-proxy";

interface User {
  login: string;
  avatar_url: string;
  name: string | null;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  authMode: "oauth" | "pat";
  loginWithToken: (token: string) => Promise<void>;
  loginWithOAuth: () => void;
  logout: () => void;
  selectedOrg: string | null;
  setSelectedOrg: (org: string | null) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(
    localStorage.getItem("gp_org"),
  );
  const authMode = getAuthMode();

  useEffect(() => {
    // Check for OAuth callback token in URL params
    const params = new URLSearchParams(window.location.search);
    const callbackToken = params.get("token");
    if (callbackToken) {
      window.history.replaceState({}, "", window.location.pathname);
      localStorage.setItem("gp_token", callbackToken);
      resetOctokit();
      fetchUser()
        .then(setUser)
        .catch(() => localStorage.removeItem("gp_token"))
        .finally(() => setIsLoading(false));
      return;
    }

    // Dev mode: auto-inject token and org from env vars (always override)
    const devToken = import.meta.env.VITE_DEV_TOKEN;
    if (devToken) {
      localStorage.setItem("gp_token", devToken);
      resetOctokit();
    }
    const devOrg = import.meta.env.VITE_DEV_ORG;
    if (devOrg) {
      localStorage.setItem("gp_org", devOrg);
      setSelectedOrg(devOrg);
    }

    // Check for existing stored token (also migrate from old dashboard)
    const token =
      localStorage.getItem("gp_token") ??
      localStorage.getItem("n1_github_token");
    if (token) {
      localStorage.setItem("gp_token", token);
      fetchUser()
        .then(setUser)
        .catch(() => localStorage.removeItem("gp_token"))
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const loginWithToken = async (token: string) => {
    localStorage.setItem("gp_token", token);
    resetOctokit();
    const userData = await fetchUser();
    setUser(userData);
  };

  const loginWithOAuth = () => {
    window.location.href = getOAuthLoginUrl();
  };

  const logout = () => {
    localStorage.removeItem("gp_token");
    localStorage.removeItem("gp_org");
    resetOctokit();
    setUser(null);
    setSelectedOrg(null);
  };

  const handleSetOrg = (org: string | null) => {
    setSelectedOrg(org);
    if (org) localStorage.setItem("gp_org", org);
    else localStorage.removeItem("gp_org");
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
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

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
