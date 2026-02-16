// Token encryption helpers
// For now, tokens are stored as-is since they're already in-transit via HTTPS
// and D1 is private to the Cloudflare account.
// Future: add AES-GCM encryption using a secret stored in env vars.

export function encryptToken(token) {
  return token;
}

export function decryptToken(encrypted) {
  return encrypted;
}
