/**
 * Unit tests for InMemoryStateStore — the non-durable StateStore used by the
 * local runtime and tests. Mirrors the Durable-Object store's semantics.
 */
import { InMemoryStateStore } from "./memory-state-store.js";
import type { AgentResult, CostBreakdown, TaskRequest } from "../types.js";

const request: TaskRequest = {
  description: "x",
  agentType: "codegen",
  repo: { owner: "a", repo: "b", branch: "c", baseBranch: "main", files: {} },
};

const cost: CostBreakdown = {
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
  estimatedCostUsd: 0.01,
  cpuTimeMs: 5,
  subrequests: 1,
};

const result = (subtaskId: string): AgentResult => ({
  subtaskId,
  agentType: "codegen",
  success: true,
  output: { files: {}, summary: "ok" },
  cost,
  durationMs: 1,
});

describe("InMemoryStateStore", () => {
  it("creates a task in pending state and returns a clone", async () => {
    const store = new InMemoryStateStore();
    const created = await store.create("t1", request);
    expect(created.status).toBe("pending");

    // Returned value is a clone — mutating it doesn't affect the store.
    created.status = "failed";
    const fetched = await store.get("t1");
    expect(fetched?.status).toBe("pending");
  });

  it("returns null for an unknown task", async () => {
    const store = new InMemoryStateStore();
    expect(await store.get("nope")).toBeNull();
  });

  it("setSubtasks moves the task to assigned", async () => {
    const store = new InMemoryStateStore();
    await store.create("t1", request);
    await store.setSubtasks("t1", [
      { id: "s1", agentType: "codegen", description: "d", context: {}, dependencies: [] },
    ]);
    const task = await store.get("t1");
    expect(task?.status).toBe("assigned");
    expect(task?.subtasks).toHaveLength(1);
  });

  it("enforces valid transitions and rejects invalid ones", async () => {
    const store = new InMemoryStateStore();
    await store.create("t1", request);
    await store.transition("t1", "assigned");
    await store.transition("t1", "running");
    await expect(store.transition("t1", "approved")).rejects.toThrow(/Invalid transition/);
  });

  it("stamps completedAt on terminal transitions", async () => {
    const store = new InMemoryStateStore();
    await store.create("t1", request);
    await store.transition("t1", "assigned");
    await store.transition("t1", "running");
    await store.transition("t1", "failed");
    expect((await store.get("t1"))?.completedAt).toBeGreaterThan(0);
  });

  it("aggregates cost across results and clears them", async () => {
    const store = new InMemoryStateStore();
    await store.create("t1", request);
    await store.addResult("t1", result("s1"));
    await store.addResult("t1", result("s2"));
    expect((await store.get("t1"))?.cost?.totalTokens).toBe(60);

    await store.clearResults("t1");
    const task = await store.get("t1");
    expect(task?.results).toEqual({});
    expect(task?.cost).toBeUndefined();
  });

  it("setReviewUrl and setError update the task", async () => {
    const store = new InMemoryStateStore();
    await store.create("t1", request);
    await store.setReviewUrl("t1", "https://example.com/pr/1");
    expect((await store.get("t1"))?.reviewUrl).toBe("https://example.com/pr/1");

    await store.setError("t1", "boom");
    const task = await store.get("t1");
    expect(task?.status).toBe("failed");
    expect(task?.error).toBe("boom");
  });

  it("records cost and filters usage by `since`", async () => {
    const store = new InMemoryStateStore();
    await store.recordCost("t1", cost);
    await store.recordCost("t2", cost);

    const all = await store.getUsage();
    expect(all.tasks).toHaveLength(2);
    expect(all.aggregate.totalTokens).toBe(60);

    // A future `since` filters everything out.
    const none = await store.getUsage(Date.now() + 10_000);
    expect(none.tasks).toHaveLength(0);
    expect(none.aggregate).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      cpuTimeMs: 0,
      subrequests: 0,
    });
  });

  it("throws when mutating a task that does not exist", async () => {
    const store = new InMemoryStateStore();
    await expect(store.transition("ghost", "assigned")).rejects.toThrow(/not found/);
  });
});
