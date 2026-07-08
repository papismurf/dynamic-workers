/**
 * End-to-end tests for the local Node HTTP server (createNodeServer): CORS
 * preflight, JSON body parsing, the 404 / 500 fallbacks, and SSE log streaming.
 * Boots a real server on an ephemeral port and drives it over HTTP.
 */
import type { AddressInfo } from "node:net";
import { createNodeServer, type AppDeps } from "./server.js";
import { Orchestrator } from "../core/orchestrator.js";
import { InMemoryStateStore } from "../core/memory-state-store.js";
import { LogHub } from "./log-hub.js";
import type { AgentRuntime, AgentRunSpec } from "../core/ports.js";
import type { AgentResult, CreateTaskRequest } from "../types.js";

const okRuntime: AgentRuntime = {
  runAgent(spec: AgentRunSpec): Promise<AgentResult> {
    return Promise.resolve({
      subtaskId: spec.subtask.id,
      agentType: spec.subtask.agentType,
      success: true,
      output: { files: {}, summary: "ok" },
      cost: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        cpuTimeMs: 0,
        subrequests: 0,
      },
      durationMs: 0,
    });
  },
};

const validBody: CreateTaskRequest = {
  tasks: [
    {
      description: "x",
      agentType: "codegen",
      repo: { owner: "a", repo: "b", branch: "c", baseBranch: "main", files: {} },
    },
  ],
};

let deps: AppDeps;
let server: ReturnType<typeof createNodeServer>;
let base: string;

beforeAll(async () => {
  const store = new InMemoryStateStore();
  const orchestrator = new Orchestrator(store, okRuntime, { maxParallelAgents: 2 });
  deps = { orchestrator, logHub: new LogHub() };
  server = createNodeServer(deps);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("createNodeServer", () => {
  it("answers CORS preflight with 204", async () => {
    const res = await fetch(`${base}/tasks`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("serves GET /health through the full pipeline", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "healthy", runtime: "local" });
  });

  it("parses a JSON body on POST /tasks and returns 201", async () => {
    const res = await fetch(`${base}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).taskIds).toHaveLength(1);
  });

  it("returns 404 for an unknown route", async () => {
    const res = await fetch(`${base}/does-not-exist`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("returns 500 when the request body is not valid JSON", async () => {
    const res = await fetch(`${base}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("internal_error");
  });

  it("streams buffered logs over SSE and cleans up on disconnect", async () => {
    deps.logHub.publish("stream-task", {
      level: "log",
      message: "hello-sse",
      timestamp: 1,
    });

    const controller = new AbortController();
    const res = await fetch(`${base}/tasks/stream-task/stream`, {
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    expect(chunk).toContain("data:");
    expect(chunk).toContain("hello-sse");

    // Disconnect — fires the server's req 'close' handler (unsubscribe).
    await reader.cancel();
    controller.abort();
  });
});
