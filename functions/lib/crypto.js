// Token encryption helpers using AES-256-GCM (Web Crypto API)
// ENCRYPTION_KEY env var must be a 64-char hex string (256 bits).

/**
 * Import a hex-encoded 256-bit key as a CryptoKey for AES-GCM.
 */
async function importKey(hexKey) {
  const keyBytes = new Uint8Array(hexKey.match(/.{2}/g).map((b) => parseInt(b, 16)));
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt a plaintext token with AES-256-GCM.
 * Returns "iv:ciphertext" as a hex string.
 * If no key is provided, returns the token as-is (graceful fallback).
 */
export async function encryptToken(token, key) {
  if (!key) {
    console.warn("[gitpulse] ENCRYPTION_KEY not set — token stored in plaintext. Set ENCRYPTION_KEY env var for AES-256-GCM encryption.");
    return token;
  }

  const cryptoKey = await importKey(key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(token);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encoded,
  );

  const ivHex = [...iv].map((b) => b.toString(16).padStart(2, "0")).join("");
  const cipherHex = [...new Uint8Array(cipherBuf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${ivHex}:${cipherHex}`;
}

/**
 * Decrypt an "iv:ciphertext" hex string back to plaintext.
 * If the value doesn't look encrypted (no colon), returns it as-is
 * (handles legacy unencrypted tokens).
 * If no key is provided, returns the value as-is (graceful fallback).
 */
export async function decryptToken(encrypted, key) {
  if (!key) return encrypted;
  if (!encrypted.includes(":")) return encrypted;

  const [ivHex, cipherHex] = encrypted.split(":");
  const iv = new Uint8Array(ivHex.match(/.{2}/g).map((b) => parseInt(b, 16)));
  const cipherBytes = new Uint8Array(
    cipherHex.match(/.{2}/g).map((b) => parseInt(b, 16)),
  );

  const cryptoKey = await importKey(key);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    cipherBytes,
  );
  return new TextDecoder().decode(plainBuf);
}
