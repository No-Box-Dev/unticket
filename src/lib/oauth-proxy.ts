/**
 * Lightweight OAuth token exchange.
 *
 * Uses Cloudflare Pages Function at /api/auth/callback.
 * VITE_OAUTH_PROXY_URL can override with an external proxy.
 * Falls back to PAT token input when CLIENT_ID is not set.
 */

const PROXY_URL = import.meta.env.VITE_OAUTH_PROXY_URL as string | undefined;
const CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID as string | undefined;

export function getAuthMode(): "oauth" | "pat" {
  return CLIENT_ID ? "oauth" : "pat";
}

export function getOAuthLoginUrl(): string {
  const redirectUri = PROXY_URL
    ? `${PROXY_URL}?redirect=${encodeURIComponent(window.location.origin)}`
    : `${window.location.origin}/api/auth/callback`;

  // Generate random state for CSRF protection
  const stateArray = new Uint8Array(32);
  crypto.getRandomValues(stateArray);
  const state = [...stateArray].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Store state in both sessionStorage (client verification) and a cookie (server verification)
  sessionStorage.setItem("gp_oauth_state", state);
  document.cookie = `gp_oauth_state=${state}; Path=/; Max-Age=600; SameSite=Lax; Secure`;

  return `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent("repo read:org")}&state=${state}`;
}
