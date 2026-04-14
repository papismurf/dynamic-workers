/**
 * LogSession + DynamicWorkerTail tests.
 *
 * LogSession stores logs, fans out to WebSocket subscribers, and hands out
 * LogWaiter handles. DynamicWorkerTail normalizes Worker trace events and
 * pushes them into the corresponding LogSession via the `exports` registry.
 */

import { LogSession, DynamicWorkerTail } from "./observability.js";
import { installWebSocketPair, type FakeServerWebSocket } from "../tests/helpers/ws.js";
import { InMemoryStorage } from "../tests/helpers/storage.js";
import {
  exports as workerExports,
  resetExports,
} from "../tests/helpers/cloudflare-workers.js";
import type { LogEntry } from "./types.js";

let uninstallWs: () => void;
beforeAll(() => {
  uninstallWs = installWebSocketPair();
});
afterAll(() => {
  uninstallWs();
});
afterEach(() => {
  resetExports();
});

function makeLogSession(): LogSession {
  return new LogSession(
    { storage: new InMemoryStorage(), props: {} } as never,
    {} as never
  );
}

// ---------------------------------------------------------------------------
// LogSession fan-out
// ---------------------------------------------------------------------------

describe("LogSession.addLogs", () => {
  it("accumulates logs and fans them out to websocket subscribers", async () => {
    const ls = makeLogSession();
    const req = new Request("https://internal/ws", {
      headers: { Upgrade: "websocket" },
    });
    const resp = await ls.fetch(req);
    const server = resp.webSocket as unknown as FakeServerWebSocket;
    expect(server).toBeDefined();

    const logs: LogEntry[] = [
      { level: "info", message: "hello", timestamp: 1 },
    ];
    await ls.addLogs(logs);

    expect(server.sent).toHaveLength(1);
    expect(JSON.parse(server.sent[0]!)).toEqual({ type: "logs", data: logs });
  });

  it("replays prior logs to new websocket subscribers", async () => {
    const ls = makeLogSession();
    await ls.addLogs([{ level: "info", message: "before", timestamp: 1 }]);

    const resp = await ls.fetch(
      new Request("https://internal/ws", { headers: { Upgrade: "websocket" } })
    );
    const server = resp.webSocket as unknown as FakeServerWebSocket;
    expect(server.sent).toHaveLength(1);
    expect(JSON.parse(server.sent[0]!).data).toEqual([
      { level: "info", message: "before", timestamp: 1 },
    ]);
  });

  it("cleans up websockets on send failure", async () => {
    const ls = makeLogSession();
    const resp = await ls.fetch(
      new Request("https://internal/ws", { headers: { Upgrade: "websocket" } })
    );
    const server = resp.webSocket as unknown as FakeServerWebSocket;
    // Force send() to throw once — simulates a dead peer.
    const originalSend = server.send.bind(server);
    let threw = false;
    (server as unknown as { send: (m: string) => void }).send = () => {
      threw = true;
      throw new Error("peer gone");
    };

    await ls.addLogs([{ level: "info", message: "x", timestamp: 1 }]);
    expect(threw).toBe(true);

    // Restore and ensure the dead socket was removed: next fan-out doesn't
    // throw, and the restored send is not called.
    (server as unknown as { send: typeof originalSend }).send = originalSend;
    await ls.addLogs([{ level: "info", message: "y", timestamp: 2 }]);
    expect(server.sent).toHaveLength(0);
  });

  it("also notifies active waiters", async () => {
    const ls = makeLogSession();
    const waiter = await ls.waitForLogs();
    const p = waiter.getLogs(5_000);
    await ls.addLogs([{ level: "info", message: "z", timestamp: 3 }]);
    const logs = await p;
    expect(logs).toEqual([{ level: "info", message: "z", timestamp: 3 }]);
  });
});

describe("LogSession.fetch (non-ws)", () => {
  it("returns accumulated logs as JSON", async () => {
    const ls = makeLogSession();
    await ls.addLogs([{ level: "error", message: "nope", timestamp: 4 }]);
    const resp = await ls.fetch(new Request("https://internal/"));
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual([
      { level: "error", message: "nope", timestamp: 4 },
    ]);
  });
});

describe("LogWaiter.getLogs", () => {
  it("resolves with whatever it has after the timeout", async () => {
    jest.useFakeTimers();
    const ls = makeLogSession();
    const waiter = await ls.waitForLogs();
    const p = waiter.getLogs(50);
    jest.advanceTimersByTime(50);
    await expect(p).resolves.toEqual([]);
    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// DynamicWorkerTail
// ---------------------------------------------------------------------------

describe("DynamicWorkerTail.tail", () => {
  it("normalizes log events + exceptions and pushes to LogSession", async () => {
    const received: LogEntry[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (workerExports as any).LogSession = {
      getByName: () => ({
        addLogs(entries: LogEntry[]) {
          received.push(...entries);
        },
      }),
    };

    const tail = new DynamicWorkerTail(
      { props: { workerId: "w-1", taskId: "t-1" } } as never,
      {} as never
    );

    await tail.tail([
      {
        logs: [
          { level: "log", message: ["hello", { foo: 1 }], timestamp: 10 },
        ],
        exceptions: [
          { name: "TypeError", message: "bad", timestamp: 11 },
        ],
      },
      // Second event with no logs/exceptions shouldn't crash.
      { logs: [], exceptions: [] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    expect(received).toHaveLength(2);
    expect(received[0]).toMatchObject({
      level: "log",
      message: 'hello {"foo":1}',
      workerId: "w-1",
      taskId: "t-1",
    });
    expect(received[1]).toMatchObject({
      level: "error",
      message: "TypeError: bad",
    });
  });

  it("is a no-op when events contain nothing to forward", async () => {
    let called = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (workerExports as any).LogSession = {
      getByName: () => ({
        addLogs() {
          called += 1;
        },
      }),
    };
    const tail = new DynamicWorkerTail(
      { props: { workerId: "w", taskId: "t" } } as never,
      {} as never
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await tail.tail([{ logs: [], exceptions: [] }] as any);
    expect(called).toBe(0);
  });
});
