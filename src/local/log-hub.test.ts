/**
 * Unit tests for LogHub — the in-process log buffer + fan-out backing SSE.
 */
import { LogHub } from "./log-hub.js";
import type { LogEntry } from "../types.js";

const entry = (message: string): LogEntry => ({
  level: "log",
  message,
  timestamp: 1,
});

describe("LogHub", () => {
  it("buffers logs per task and returns history", () => {
    const hub = new LogHub();
    hub.publish("t1", entry("a"));
    hub.publish("t1", entry("b"));
    hub.publish("t2", entry("c"));

    expect(hub.history("t1").map((e) => e.message)).toEqual(["a", "b"]);
    expect(hub.history("t2").map((e) => e.message)).toEqual(["c"]);
    expect(hub.history("unknown")).toEqual([]);
  });

  it("fans out new entries to live subscribers only", () => {
    const hub = new LogHub();
    const seen: string[] = [];
    const unsubscribe = hub.subscribe("t1", (e) => seen.push(e.message));

    hub.publish("t1", entry("one"));
    hub.publish("t2", entry("other-task")); // different task, not delivered
    expect(seen).toEqual(["one"]);

    unsubscribe();
    hub.publish("t1", entry("after-unsub"));
    expect(seen).toEqual(["one"]);
  });

  it("supports multiple concurrent subscribers", () => {
    const hub = new LogHub();
    const a: string[] = [];
    const b: string[] = [];
    hub.subscribe("t1", (e) => a.push(e.message));
    hub.subscribe("t1", (e) => b.push(e.message));
    hub.publish("t1", entry("x"));
    expect(a).toEqual(["x"]);
    expect(b).toEqual(["x"]);
  });
});
