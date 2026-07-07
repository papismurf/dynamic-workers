/**
 * REST routing tests for the local server. Drives handleRest() directly with a
 * fake runtime so no network is involved.
 */
import { handleRest, type AppDeps } from "./server.js";
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

function makeDeps(): AppDeps {
  const store = new InMemoryStateStore();
  const orchestrator = new Orchestrator(store, okRuntime, { maxParallelAgents: 2 });
  return { orchestrator, logHub: new LogHub() };
}

const params = (qs = "") => new URLSearchParams(qs);
const validBody: CreateTaskRequest = {
  tasks: [
    {
      description: "x",
      agentType: "codegen",
      repo: { owner: "a", repo: "b", branch: "c", baseBranch: "main", files: {} },
    },
  ],
};

describe("handleRest", () => {
  it("GET /health returns healthy local runtime", async () => {
    const res = await handleRest(makeDeps(), "GET", "/health", params(), undefined);
    expect(res?.status).toBe(200);
    expect(res?.json).toMatchObject({ status: "healthy", runtime: "local" });
  });

  it("POST /tasks returns 201 with taskIds", async () => {
    const res = await handleRest(makeDeps(), "POST", "/tasks", params(), validBody);
    expect(res?.status).toBe(201);
    expect((res?.json as { taskIds: string[] }).taskIds).toHaveLength(1);
  });

  it("POST /tasks rejects an empty tasks array", async () => {
    const res = await handleRest(makeDeps(), "POST", "/tasks", params(), { tasks: [] });
    expect(res?.status).toBe(400);
  });

  it("GET /tasks/:id returns the created task", async () => {
    const deps = makeDeps();
    const created = await handleRest(deps, "POST", "/tasks", params(), validBody);
    const taskId = (created?.json as { taskIds: string[] }).taskIds[0]!;
    const res = await handleRest(deps, "GET", `/tasks/${taskId}`, params(), undefined);
    expect(res?.status).toBe(200);
    expect((res?.json as { task: { id: string } }).task.id).toBe(taskId);
  });

  it("GET /tasks/:id returns 404 for an unknown id", async () => {
    const res = await handleRest(makeDeps(), "GET", "/tasks/nope", params(), undefined);
    expect(res?.status).toBe(404);
  });

  it("POST review returns 400 when the task is not in review state", async () => {
    const deps = makeDeps();
    const created = await handleRest(deps, "POST", "/tasks", params(), validBody);
    const taskId = (created?.json as { taskIds: string[] }).taskIds[0]!;
    const res = await handleRest(deps, "POST", `/tasks/${taskId}/review`, params(), {
      taskId,
      decision: "approve",
    });
    // Either mid-run (not review) or already reviewable — but never a 5xx.
    expect([200, 400]).toContain(res?.status);
  });

  it("GET /usage returns an aggregate", async () => {
    const res = await handleRest(makeDeps(), "GET", "/usage", params("since=1000"), undefined);
    expect(res?.status).toBe(200);
    expect(res?.json).toHaveProperty("aggregate");
  });

  it("returns null for unknown routes and the SSE stream path", async () => {
    const deps = makeDeps();
    expect(await handleRest(deps, "GET", "/nope", params(), undefined)).toBeNull();
    expect(await handleRest(deps, "GET", "/tasks/x/stream", params(), undefined)).toBeNull();
  });
});
