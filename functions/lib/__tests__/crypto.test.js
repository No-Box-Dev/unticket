import { describe, it, expect } from "vitest";
import { encryptToken, decryptToken } from "../crypto.js";

// 256-bit test key (64 hex chars)
const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("encryptToken", () => {
  it("returns iv:ciphertext format (hex with colon separator)", async () => {
    const encrypted = await encryptToken("ghp_testtoken123", TEST_KEY);
    expect(encrypted).toContain(":");
    const [iv, ciphertext] = encrypted.split(":");
    // IV should be 12 bytes = 24 hex chars
    expect(iv).toHaveLength(24);
    expect(iv).toMatch(/^[0-9a-f]+$/);
    // Ciphertext should be non-empty hex (includes GCM auth tag)
    expect(ciphertext.length).toBeGreaterThan(0);
    expect(ciphertext).toMatch(/^[0-9a-f]+$/);
  });

  it("throws when no key is provided", async () => {
    await expect(encryptToken("ghp_testtoken123", undefined)).rejects.toThrow(
      /ENCRYPTION_KEY is required/,
    );
  });

  it("throws when key is empty string", async () => {
    await expect(encryptToken("ghp_testtoken123", "")).rejects.toThrow(
      /ENCRYPTION_KEY is required/,
    );
  });

  it("throws when key is not 64 hex chars", async () => {
    await expect(encryptToken("ghp_testtoken123", "not-a-hex-key")).rejects.toThrow(
      /64-character hex string/,
    );
  });

  it("produces different ciphertexts for the same input (random IV)", async () => {
    const token = "ghp_testtoken123";
    const a = await encryptToken(token, TEST_KEY);
    const b = await encryptToken(token, TEST_KEY);
    expect(a).not.toBe(b);
  });
});

describe("decryptToken", () => {
  it("roundtrips correctly (encrypt then decrypt = original)", async () => {
    const original = "ghp_abcdefghijklmnop1234567890";
    const encrypted = await encryptToken(original, TEST_KEY);
    const decrypted = await decryptToken(encrypted, TEST_KEY);
    expect(decrypted).toBe(original);
  });

  it("roundtrips with empty string token", async () => {
    const original = "";
    const encrypted = await encryptToken(original, TEST_KEY);
    const decrypted = await decryptToken(encrypted, TEST_KEY);
    expect(decrypted).toBe(original);
  });

  it("roundtrips with long token containing special characters", async () => {
    const original = "gho_ABCDEFghijklmnop!@#$%^&*()_+-=[]{}|;':\",./<>?";
    const encrypted = await encryptToken(original, TEST_KEY);
    const decrypted = await decryptToken(encrypted, TEST_KEY);
    expect(decrypted).toBe(original);
  });

  it("throws on value without iv:ciphertext separator", async () => {
    await expect(
      decryptToken("ghp_plaintoken_no_encryption", TEST_KEY),
    ).rejects.toThrow(/iv:ciphertext/);
  });

  it("throws on malformed iv:ciphertext value", async () => {
    await expect(decryptToken("notHex:alsoNotHex", TEST_KEY)).rejects.toThrow();
  });

  it("throws when no key is provided", async () => {
    await expect(
      decryptToken("aabbccdd11223344aabbccdd:ff00ff00ff00", undefined),
    ).rejects.toThrow(/ENCRYPTION_KEY is required/);
  });

  it("throws when key is empty string", async () => {
    await expect(
      decryptToken("aabbccdd11223344aabbccdd:ff00ff00ff00", ""),
    ).rejects.toThrow(/ENCRYPTION_KEY is required/);
  });
});
