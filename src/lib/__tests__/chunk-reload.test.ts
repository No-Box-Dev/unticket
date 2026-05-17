import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isChunkLoadError, tryAutoReload } from "../chunk-reload";

describe("isChunkLoadError", () => {
  it("returns false for null/undefined", () => {
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });

  it("matches 'Failed to fetch dynamically imported module'", () => {
    expect(isChunkLoadError(new Error("Failed to fetch dynamically imported module foo"))).toBe(true);
  });

  it("matches 'Importing a module script failed'", () => {
    expect(isChunkLoadError(new Error("Importing a module script failed"))).toBe(true);
  });

  it("matches 'error loading dynamically imported module'", () => {
    expect(isChunkLoadError(new Error("error loading dynamically imported module"))).toBe(true);
  });

  it("matches ChunkLoadError", () => {
    expect(isChunkLoadError(new Error("ChunkLoadError: chunk 12 failed"))).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isChunkLoadError(new Error("TypeError: undefined is not a function"))).toBe(false);
  });
});

describe("tryAutoReload", () => {
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    reloadSpy = vi.fn();
    // window.location is non-configurable in jsdom — replace the property.
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
    });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("reloads + increments counter on first call", () => {
    expect(tryAutoReload()).toBe(true);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(sessionStorage.getItem("preloadErrorReloads")!);
    expect(entry.count).toBe(1);
  });

  it("blocks rapid back-to-back reloads (<5s interval)", () => {
    tryAutoReload();
    reloadSpy.mockClear();
    expect(tryAutoReload()).toBe(false);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("blocks once the counter reaches 3", () => {
    // Seed the counter at 3, last reload long ago so the interval guard doesn't fire.
    sessionStorage.setItem("preloadErrorReloads", JSON.stringify({ count: 3, last: 0 }));
    expect(tryAutoReload()).toBe(false);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("allows another reload after the interval has passed", () => {
    sessionStorage.setItem(
      "preloadErrorReloads",
      JSON.stringify({ count: 1, last: Date.now() - 10_000 }),
    );
    expect(tryAutoReload()).toBe(true);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it("recovers from corrupt sessionStorage value (treats as fresh)", () => {
    sessionStorage.setItem("preloadErrorReloads", "not json");
    expect(tryAutoReload()).toBe(true);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
