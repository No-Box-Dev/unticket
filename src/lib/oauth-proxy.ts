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

  return `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent("repo read:org")}`;
}
