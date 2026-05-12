// Token encryption helpers using AES-256-GCM (Web Crypto API).
// ENCRYPTION_KEY env var must be a 64-char hex string (256 bits).
//
// No plaintext fallback: writes refuse to proceed without a key, and reads
// refuse to accept a value that doesn't look like `<iv>:<cipher>`. Migration
// 0016 deletes any legacy plaintext rows so reads can't trip over them.

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
 * Returns "iv:ciphertext" as a hex string. Throws if `key` is missing.
 */
export async function encryptToken(token, key) {
  if (!key) throw new Error("ENCRYPTION_KEY is required");

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
 * Throws if `key` is missing or the value isn't in the expected format.
 */
export async function decryptToken(encrypted, key) {
  if (!key) throw new Error("ENCRYPTION_KEY is required");
  if (typeof encrypted !== "string" || !encrypted.includes(":")) {
    throw new Error("Encrypted token must be in iv:ciphertext format");
  }

  const parts = encrypted.split(":");
  if (parts.length !== 2) throw new Error("Malformed encrypted token");
  const [ivHex, cipherHex] = parts;
  const ivMatch = ivHex.match(/.{2}/g);
  const cipherMatch = cipherHex.match(/.{2}/g);
  if (!ivMatch || !cipherMatch) throw new Error("Malformed encrypted token");
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
