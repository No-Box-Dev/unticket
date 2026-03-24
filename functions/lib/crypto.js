// Token encryption helpers using AES-256-GCM (Web Crypto API)
// ENCRYPTION_KEY env var must be a 64-char hex string (256 bits).

/**
 * Import a hex-encoded 256-bit key as a CryptoKey for AES-GCM.
 */
async function importKey(hexKey) {
  if (!hexKey || typeof hexKey !== "string" || !/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    throw new Error("ENCRYPTION_KEY must be a 64-character hex string");
  }
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

  const parts = encrypted.split(":");
  if (parts.length !== 2) return encrypted; // Not in expected format, return as-is
  const [ivHex, cipherHex] = parts;
  const ivMatch = ivHex.match(/.{2}/g);
  const cipherMatch = cipherHex.match(/.{2}/g);
  if (!ivMatch || !cipherMatch) return encrypted; // Malformed, return as-is
  const iv = new Uint8Array(ivMatch.map((b) => parseInt(b, 16)));
  const cipherBytes = new Uint8Array(cipherMatch.map((b) => parseInt(b, 16)));

  const cryptoKey = await importKey(key);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    cipherBytes,
  );
  return new TextDecoder().decode(plainBuf);
}
