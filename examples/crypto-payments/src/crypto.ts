import { createHmac, timingSafeEqual } from "node:crypto";

/** Compute a hex HMAC-SHA256 of `payload` with `secret`. */
export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two hex signatures. Returns false on any length
 * mismatch or malformed input rather than throwing, so callers can treat a
 * false result as "verification failed".
 */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}
