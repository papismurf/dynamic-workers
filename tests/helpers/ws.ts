/**
 * WebSocketPair shim for Node-side tests of observability.ts. The real
 * Workers runtime exposes a global `WebSocketPair` that returns `[client,
 * server]` both satisfying the `WebSocket` interface. Tests here only need
 * the server half's send/close/addEventListener surface.
 */

export interface FakeServerWebSocket extends WebSocket {
  /** Testing hook: every message the server has sent. */
  readonly sent: string[];
  /** Testing hook: simulate the client-side close. */
  _triggerClose(code?: number, reason?: string): void;
}

function createPair(): [WebSocket, FakeServerWebSocket] {
  const listeners: Record<string, Array<(ev: unknown) => void>> = {};
  const sent: string[] = [];
  let closed = false;

  const server: FakeServerWebSocket = {
    accept() {
      /* mimic the real API — tests only verify behavior post-accept */
    },
    send(message: string | ArrayBuffer) {
      if (closed) throw new Error("WebSocket is closed");
      sent.push(typeof message === "string" ? message : "<binary>");
    },
    close() {
      closed = true;
    },
    addEventListener(type: string, cb: (ev: unknown) => void) {
      (listeners[type] ??= []).push(cb);
    },
    removeEventListener() {
      /* not needed in tests */
    },
    dispatchEvent() {
      return true;
    },
    get readyState() {
      return closed ? 3 : 1;
    },
    get sent() {
      return sent;
    },
    _triggerClose(code = 1000, reason = "") {
      closed = true;
      for (const cb of listeners["close"] ?? []) cb({ code, reason });
    },
  } as unknown as FakeServerWebSocket;

  // The client half is never driven from tests — minimal stub.
  const client = {
    send() {},
    close() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    readyState: 1,
  } as unknown as WebSocket;

  return [client, server];
}

/**
 * Install a global WebSocketPair so code that does `new WebSocketPair()`
 * inside observability.ts works under Jest. Call in beforeAll / afterAll.
 */
export function installWebSocketPair(): () => void {
  const original = (globalThis as { WebSocketPair?: unknown }).WebSocketPair;
  class _WebSocketPair {
    0: WebSocket;
    1: FakeServerWebSocket;
    constructor() {
      const [client, server] = createPair();
      this[0] = client;
      this[1] = server;
    }
  }
  (globalThis as { WebSocketPair?: unknown }).WebSocketPair = _WebSocketPair;
  return () => {
    (globalThis as { WebSocketPair?: unknown }).WebSocketPair = original;
  };
}
