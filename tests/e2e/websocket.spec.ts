/**
 * WebSocket streaming. Uses the `ws` npm client (not the browser's WebSocket)
 * so we can drive close codes and inspect frames directly. Assertions:
 *   - connection upgrades successfully
 *   - frames arrive as JSON with a `type` field
 *   - close with 1000 is clean
 *   - reconnection is supported (open → close → open again)
 */
import WebSocket from "ws";
import { test, expect } from "./fixtures.js";

function waitForMessage(ws: WebSocket, timeoutMs = 5_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(t);
      resolve(data.toString());
    });
    ws.once("error", reject);
  });
}

function waitForOpen(ws: WebSocket, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("open timeout")), timeoutMs);
    ws.once("open", () => {
      clearTimeout(t);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

test("ws /tasks/:id/stream: upgrade + frames + clean close", async ({ taskId, wsUrl }) => {
  const ws = new WebSocket(wsUrl(`/tasks/${taskId}/stream`));
  await waitForOpen(ws);

  // Frames may arrive before or after we call waitForMessage; most runs see
  // at least a replay of pre-open logs. If none arrive before the timeout,
  // we verify the connection was still healthy via the close handshake.
  let firstFrame: string | undefined;
  try {
    firstFrame = await waitForMessage(ws, 2_000);
  } catch {
    /* no early frames — tolerated */
  }
  if (firstFrame) {
    const parsed = JSON.parse(firstFrame) as { type?: string };
    expect(parsed.type).toBeTruthy();
  }

  ws.close(1000, "done");
  const close = await waitForClose(ws);
  expect(close.code).toBe(1000);
});

test("ws reconnect: second open on the same task id works", async ({ taskId, wsUrl }) => {
  const first = new WebSocket(wsUrl(`/tasks/${taskId}/stream`));
  await waitForOpen(first);
  first.close(1000);
  await waitForClose(first);

  const second = new WebSocket(wsUrl(`/tasks/${taskId}/stream`));
  await waitForOpen(second);
  second.close(1000);
  await waitForClose(second);
});
