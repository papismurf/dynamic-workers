/**
 * Jest setup: install Cloudflare Workers runtime globals that Node/undici does
 * not provide, so source that targets the Workers runtime can be exercised
 * unchanged in unit tests.
 *
 * - `WebSocketPair`: a constructible `[client, server]` pair (from ws.ts).
 * - `Response` with `status: 101` + a `webSocket` init field: the Workers
 *   runtime returns these for WebSocket upgrades, but undici's `Response`
 *   constructor rejects status 101 and drops the `webSocket` field. We install
 *   a thin subclass that preserves both while delegating everything else.
 *
 * Wired via `setupFiles` in jest.config.ts, so it runs once per test file
 * (each file gets its own sandboxed globals).
 */
import { installWebSocketPair } from "./ws.js";

installWebSocketPair();

type WorkerResponseInit = ResponseInit & { webSocket?: unknown };

const BaseResponse = globalThis.Response;

class WorkerResponse extends BaseResponse {
  readonly webSocket: unknown | null = null;

  constructor(body?: BodyInit | null, init?: WorkerResponseInit) {
    const wantsUpgrade = init?.webSocket !== undefined || init?.status === 101;
    if (wantsUpgrade) {
      // undici forbids status 101 in the constructor and ignores `webSocket`,
      // so build a valid Response and then mirror the Workers-style upgrade.
      const { webSocket, status, ...rest } = init ?? {};
      super(body, rest);
      Object.defineProperty(this, "status", {
        value: status ?? 101,
        configurable: true,
      });
      this.webSocket = webSocket ?? null;
    } else {
      super(body, init);
    }
  }
}

globalThis.Response = WorkerResponse as unknown as typeof Response;
