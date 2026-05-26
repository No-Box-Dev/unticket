/**
 * GitHub App user-OAuth helpers.
 *
 * Sign-in goes through the App's user-authorization endpoint:
 *   https://github.com/login/oauth/authorize?client_id=<App client id>...
 * No `scope` query param — GitHub Apps grant whatever the App was configured for.
 *
 * The Cloudflare Pages Function at /api/auth/callback exchanges the code.
 * VITE_OAUTH_PROXY_URL can override with an external proxy.
 * Falls back to PAT token input when the App client id is not configured.
 */

const PROXY_URL = import.meta.env.VITE_OAUTH_PROXY_URL as string | undefined;
const CLIENT_ID = import.meta.env.VITE_GITHUB_APP_CLIENT_ID as string | undefined;

export function getAuthMode(): "oauth" | "pat" {
  return CLIENT_ID ? "oauth" : "pat";
}

export function getOAuthLoginUrl(): string {
  const redirectUri = PROXY_URL
    ? `${PROXY_URL}?redirect=${encodeURIComponent(window.location.origin)}`
    : `${window.location.origin}/api/auth/callback`;

  const stateArray = new Uint8Array(32);
  crypto.getRandomValues(stateArray);
  const state = [...stateArray].map((b) => b.toString(16).padStart(2, "0")).join("");
  sessionStorage.setItem("ut_oauth_state", state);
  document.cookie = `ut_oauth_state=${state}; Path=/; Max-Age=600; SameSite=Lax; Secure`;

  return `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
}
