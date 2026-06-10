/**
 * GitHub App user-OAuth helpers.
 *
 * Sign-in goes through the App's user-authorization endpoint:
 *   https://github.com/login/oauth/authorize?client_id=<App client id>...
 * No `scope` query param — GitHub Apps grant whatever the App was configured for.
 *
 * The Cloudflare Pages Function at /api/auth/callback exchanges the code.
 * VITE_OAUTH_PROXY_URL can override with an external proxy.
 */

const PROXY_URL = import.meta.env.VITE_OAUTH_PROXY_URL as string | undefined;
const CLIENT_ID = import.meta.env.VITE_GITHUB_APP_CLIENT_ID as string | undefined;

export function getOAuthLoginUrl(): string {
  if (!CLIENT_ID) {
    // Fail loud rather than redirecting to GitHub with `client_id=undefined`
    // (which yields an opaque GitHub error page). Surface the misconfiguration
    // to the operator. Build-time fix: set VITE_GITHUB_APP_CLIENT_ID in the
    // deploy workflow's `npm run build` step.
    throw new Error(
      "OAuth not configured: VITE_GITHUB_APP_CLIENT_ID is missing in this build.",
    );
  }

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
