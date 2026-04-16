/**
 * TaskManager + CostTracker DO tests. The in-memory storage fake from
 * tests/helpers provides just enough of the ctx.storage surface to exercise
 * real transition logic without spinning up miniflare.
 */
import { TaskManager, CostTracker } from "./state.js";
import { InMemoryStorage } from "../tests/helpers/storage.js";
import type {
  TaskRequest,
  TaskStatus,
  AgentResult,
  CostBreakdown,
} from "./types.js";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function buildRequest(overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    description: "Add rate limiting middleware",
    agentType: "codegen",
    repo: {
      owner: "acme",
      repo: "api",
      branch: "agent/rl",
      baseBranch: "main",
      files: { "src/index.ts": "export {};" },
    },
    ...overrides,
  };
}

function buildCost(partial: Partial<CostBreakdown> = {}): CostBreakdown {
  return {
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    estimatedCostUsd: 0.001,
    cpuTimeMs: 42,
    subrequests: 1,
    ...partial,
  };
}

function buildResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    subtaskId: "st-1",
    agentType: "codegen",
    success: true,
    output: { files: {}, summary: "done" },
    cost: buildCost(),
    durationMs: 100,
    ...overrides,
  };
}

function makeTaskManager(): TaskManager {
  const storage = new InMemoryStorage();
  return new TaskManager({ storage, props: {} } as never, {} as never);
}

// ---------------------------------------------------------------------------
// initialize / getState
// ---------------------------------------------------------------------------

describe("TaskManager.initialize", () => {
  it("returns a fresh pending state and persists it", async () => {
    const tm = makeTaskManager();
    const req = buildRequest();
    const state = await tm.initialize("task-1", req);

    expect(state.id).toBe("task-1");
    expect(state.status).toBe("pending");
    expect(state.subtasks).toEqual([]);
    expect(state.results).toEqual({});
    expect(state.createdAt).toBeGreaterThan(0);
    expect(state.updatedAt).toBe(state.createdAt);
  });

  it("is idempotent at the storage layer — re-initialize overwrites", async () => {
    const tm = makeTaskManager();
    await tm.initialize("task-1", buildRequest({ description: "first" }));
    const second = await tm.initialize(
      "task-1",
      buildRequest({ description: "second" })
    );
    expect(second.request.description).toBe("second");
    expect(second.results).toEqual({});
  });
});

describe("TaskManager.getState", () => {
  it("lazily loads persisted state if not in-memory", async () => {
    const storage = new InMemoryStorage();
    const tm1 = new TaskManager({ storage, props: {} } as never, {} as never);
    await tm1.initialize("task-1", buildRequest());

    // Fresh instance wired to the same storage — simulates DO eviction.
    const tm2 = new TaskManager({ storage, props: {} } as never, {} as never);
    const state = await tm2.getState();
    expect(state.id).toBe("task-1");
  });
});

// ---------------------------------------------------------------------------
// transition — state machine
// ---------------------------------------------------------------------------

describe("TaskManager.transition", () => {
  type Case = { from: TaskStatus; to: TaskStatus; ok: boolean };

  const cases: Case[] = [
    // Valid paths
    { from: "pending", to: "assigned", ok: true },
    { from: "pending", to: "cancelled", ok: true },
    { from: "pending", to: "failed", ok: true },
    { from: "assigned", to: "running", ok: true },
    { from: "running", to: "review", ok: true },
    { from: "review", to: "approved", ok: true },
    { from: "approved", to: "completed", ok: true },
    { from: "failed", to: "pending", ok: true },

    // Invalid paths
    { from: "pending", to: "running", ok: false },
    { from: "pending", to: "approved", ok: false },
    { from: "completed", to: "pending", ok: false },
    { from: "cancelled", to: "running", ok: false },
    { from: "review", to: "running", ok: false },
  ];

  it.each(cases)(
    "$from -> $to is ${ok}",
    async ({ from, to, ok }) => {
      const tm = makeTaskManager();
      await tm.initialize("t", buildRequest());

      // Walk a valid prefix so we can start from `from` for non-pending cases.
      const prefixes: Record<TaskStatus, TaskStatus[]> = {
        pending: [],
        assigned: ["assigned"],
        running: ["assigned", "running"],
        review: ["assigned", "running", "review"],
        approved: ["assigned", "running", "review", "approved"],
        completed: ["assigned", "running", "review", "approved", "completed"],
        failed: ["failed"],
        cancelled: ["cancelled"],
      };
      for (const s of prefixes[from]) await tm.transition(s);

      if (ok) {
        await expect(tm.transition(to)).resolves.toBeUndefined();
        expect((await tm.getState()).status).toBe(to);
      } else {
        await expect(tm.transition(to)).rejects.toThrow(/Invalid transition/);
      }
    }
  );

  it("sets completedAt on terminal transitions", async () => {
    const tm = makeTaskManager();
    await tm.initialize("t", buildRequest());
    await tm.transition("assigned");
    await tm.transition("running");
    await tm.transition("failed");
    expect((await tm.getState()).completedAt).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// setSubtasks / addResult — cost aggregation
// ---------------------------------------------------------------------------

describe("TaskManager.setSubtasks", () => {
  it("moves the task to assigned and persists subtasks", async () => {
    const tm = makeTaskManager();
    await tm.initialize("t", buildRequest());
    await tm.setSubtasks([
      {
        id: "st-1",
        agentType: "codegen",
        description: "",
        context: {},
        dependencies: [],
      },
    ]);
    const state = await tm.getState();
    expect(state.status).toBe("assigned");
    expect(state.subtasks).toHaveLength(1);
  });
});

describe("TaskManager.addResult", () => {
  it("aggregates cost across results", async () => {
    const tm = makeTaskManager();
    await tm.initialize("t", buildRequest());

    await tm.addResult(
      buildResult({ subtaskId: "a", cost: buildCost({ totalTokens: 100 }) })
    );
    await tm.addResult(
      buildResult({ subtaskId: "b", cost: buildCost({ totalTokens: 250 }) })
    );

    const state = await tm.getState();
    expect(state.cost?.totalTokens).toBe(350);
    expect(state.results).toHaveProperty("a");
    expect(state.results).toHaveProperty("b");
  });

  it("is idempotent on the same subtaskId", async () => {
    const tm = makeTaskManager();
    await tm.initialize("t", buildRequest());
    const result = buildResult({ subtaskId: "a" });
    await tm.addResult(result);
    await tm.addResult(result);
    const state = await tm.getState();
    expect(Object.keys(state.results)).toEqual(["a"]);
    // Aggregation recomputes from the result map, not an incrementing counter.
    expect(state.cost?.totalTokens).toBe(result.cost.totalTokens);
  });
});

// ---------------------------------------------------------------------------
// isComplete / allSucceeded
// ---------------------------------------------------------------------------

describe("TaskManager completion predicates", () => {
  it("isComplete is false until every subtask has a result", async () => {
    const tm = makeTaskManager();
    await tm.initialize("t", buildRequest());
    await tm.setSubtasks([
      { id: "a", agentType: "codegen", description: "", context: {}, dependencies: [] },
      { id: "b", agentType: "test", description: "", context: {}, dependencies: [] },
    ]);
    expect(await tm.isComplete()).toBe(false);
    await tm.addResult(buildResult({ subtaskId: "a" }));
    expect(await tm.isComplete()).toBe(false);
    await tm.addResult(buildResult({ subtaskId: "b" }));
    expect(await tm.isComplete()).toBe(true);
  });

  it("allSucceeded requires every result to be success=true", async () => {
    const tm = makeTaskManager();
    await tm.initialize("t", buildRequest());
    await tm.addResult(buildResult({ subtaskId: "a", success: true }));
    expect(await tm.allSucceeded()).toBe(true);
    await tm.addResult(buildResult({ subtaskId: "b", success: false }));
    expect(await tm.allSucceeded()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setError / setReviewUrl
// ---------------------------------------------------------------------------

describe("TaskManager.setError", () => {
  it("marks the task failed with the error message", async () => {
    const tm = makeTaskManager();
    await tm.initialize("t", buildRequest());
    await tm.setError("boom");
    const state = await tm.getState();
    expect(state.status).toBe("failed");
    expect(state.error).toBe("boom");
    expect(state.completedAt).toBeGreaterThan(0);
  });
});

describe("TaskManager.setReviewUrl", () => {
  it("stores the review URL without changing status", async () => {
    const tm = makeTaskManager();
    await tm.initialize("t", buildRequest());
    await tm.setReviewUrl("https://github.com/acme/api/pull/42");
    const state = await tm.getState();
    expect(state.reviewUrl).toBe("https://github.com/acme/api/pull/42");
    expect(state.status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// CostTracker
// ---------------------------------------------------------------------------

describe("CostTracker", () => {
  function makeTracker(): CostTracker {
    const storage = new InMemoryStorage();
    return new CostTracker({ storage, props: {} } as never, {} as never);
  }

  it("records multiple cost entries per task", async () => {
    const t = makeTracker();
    await t.record("task-1", buildCost({ totalTokens: 100 }));
    await t.record("task-2", buildCost({ totalTokens: 250 }));

    const usage = await t.getUsage();
    expect(usage.tasks).toHaveLength(2);
    expect(usage.aggregate.totalTokens).toBe(350);
  });

  it("filters by `since` timestamp", async () => {
    const t = makeTracker();
    const nowSpy = jest.spyOn(Date, "now");

    nowSpy.mockReturnValue(1000);
    await t.record("old", buildCost({ totalTokens: 100 }));

    nowSpy.mockReturnValue(5000);
    await t.record("new", buildCost({ totalTokens: 200 }));

    const usage = await t.getUsage(2000);
    expect(usage.tasks).toHaveLength(1);
    expect(usage.tasks[0]?.taskId).toBe("new");
    expect(usage.aggregate.totalTokens).toBe(200);

    nowSpy.mockRestore();
  });

  it("returns zeroes for an empty aggregate", async () => {
    const t = makeTracker();
    const usage = await t.getUsage();
    expect(usage.tasks).toEqual([]);
    expect(usage.aggregate).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      cpuTimeMs: 0,
      subrequests: 0,
    });
  });
});
