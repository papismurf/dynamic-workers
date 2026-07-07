/**
 * Runtime-neutral id helpers.
 *
 * Both Cloudflare Workers and Node (>= 19) expose Web Crypto on `globalThis`,
 * but the ambient type for it comes from different libs (workers-types vs
 * @types/node). Referencing it through a minimal typed view lets this compile
 * under the Worker, Node, and test tsconfigs alike, with a non-crypto fallback
 * for any environment that lacks `randomUUID`.
 */
export function randomUUID(): string {
  // Read lazily per call (not captured at module load) so a runtime that
  // installs Web Crypto after import is still used.
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  return (
    webCrypto?.randomUUID?.() ??
    `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
  );
}

/** First 8 chars of a UUID — enough entropy for human-facing subtask ids. */
export function shortId(): string {
  return randomUUID().slice(0, 8);
}
