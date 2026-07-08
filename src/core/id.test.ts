/**
 * Unit tests for the runtime-neutral id helpers, covering both the Web Crypto
 * path and the non-crypto fallback.
 */
import { randomUUID, shortId } from "./id.js";

type CryptoHolder = { crypto?: { randomUUID?: () => string } };

describe("randomUUID", () => {
  const holder = globalThis as CryptoHolder;
  let original: CryptoHolder["crypto"];

  beforeEach(() => {
    original = holder.crypto;
  });
  afterEach(() => {
    holder.crypto = original;
  });

  it("uses Web Crypto's randomUUID when available", () => {
    holder.crypto = { randomUUID: () => "11111111-2222-3333-4444-555555555555" };
    expect(randomUUID()).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("falls back to a timestamp+random id when Web Crypto is absent", () => {
    holder.crypto = undefined;
    const id = randomUUID();
    expect(typeof id).toBe("string");
    expect(id).toMatch(/^[0-9a-f]+-[0-9a-f]+$/);
  });

  it("falls back when crypto exists but lacks randomUUID", () => {
    holder.crypto = {};
    expect(randomUUID()).toMatch(/^[0-9a-f]+-/);
  });
});

describe("shortId", () => {
  it("returns the first 8 characters of a UUID", () => {
    const holder = globalThis as CryptoHolder;
    const original = holder.crypto;
    holder.crypto = { randomUUID: () => "abcdef01-2222-3333-4444-555555555555" };
    try {
      expect(shortId()).toBe("abcdef01");
      expect(shortId()).toHaveLength(8);
    } finally {
      holder.crypto = original;
    }
  });
});
