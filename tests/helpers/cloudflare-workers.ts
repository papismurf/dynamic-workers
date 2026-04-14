/**
 * Shim for the virtual `cloudflare:workers` module — loaded by jest via
 * moduleNameMapper. The goal is to implement just enough of the runtime API
 * that src/* can execute in Node:
 *
 *   - `DurableObject`       base class exposing `ctx.storage`
 *   - `WorkerEntrypoint`    base class exposing `ctx.props`
 *   - `RpcTarget`           no-op marker class
 *   - `exports`             mutable registry used by src/index.ts and
 *                           src/observability.ts to discover sibling
 *                           services by name (`exports.LogSession`, etc.)
 *
 * Tests wire sibling services by setting properties on `exports` directly
 * in their setup block. See tests/helpers/env.ts for the canonical wiring.
 */

import { InMemoryStorage } from "./storage.js";

export interface FakeCtx<Props = unknown> {
  storage: InMemoryStorage;
  props: Props;
  // The real runtime exposes `id`, `waitUntil`, etc. Tests that need them
  // should attach them via type assertions rather than us speculating.
}

export class DurableObject<EnvT = unknown> {
  constructor(public ctx: FakeCtx, public env: EnvT) {}
}

export class WorkerEntrypoint<EnvT = unknown, Props = unknown> {
  constructor(public ctx: FakeCtx<Props>, public env: EnvT) {}
  // Most entrypoints override these. Keep the defaults harmless.
  async fetch(_request: Request): Promise<Response> {
    return new Response("ok");
  }
  async tail(_events: unknown[]): Promise<void> {
    /* no-op */
  }
}

export class RpcTarget {
  /* marker class, no runtime behavior needed in tests */
}

/**
 * `exports` is a module-scoped mutable registry. Production code does:
 *   `(exports as OrchestratorExports).LogSession.getByName(name)`
 * so tests populate it before the code under test runs:
 *   `(exports as any).LogSession = { getByName: () => stub };`
 *
 * Tests should call `resetExports()` in afterEach to avoid cross-test leaks.
 */
export const exports: Record<string, unknown> = {};

export function resetExports(): void {
  for (const key of Object.keys(exports)) delete exports[key];
}
