/**
 * Orchestrator core tests — dependency-wave scheduling, self-heal, review
 * flow, and cost aggregation. Uses the in-memory store and a scripted fake
 * runtime so no network or Cloudflare primitives are involved.
 */
import { Orchestrator } from "./orchestrator.js";
import { InMemoryStateStore } from "./memory-state-store.js";
import type { AgentRuntime, AgentRunSpec } from "./ports.js";
import type { AgentResult, TaskRequest } from "../types.js";

function baseRequest(): TaskRequest {
  return {
    description: "Add a helper",
    agentType: "codegen",
    repo: { owner: "a", repo: "b", branch: "c", baseBranch: "main", files: {} },
  };
}

function ok(spec: AgentRunSpec, summary = "ok"): AgentResult {
  return {
    subtaskId: spec.subtask.id,
    agentType: spec.subtask.agentType,
    success: true,
    output: { files: { "out.ts": "x" }, summary },
    cost: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      estimatedCostUsd: 0.001,
      cpuTimeMs: 1,
      subrequests: 0,
    },
    durationMs: 1,
  };
}

class AlwaysOkRuntime implements AgentRuntime {
  runAgent(spec: AgentRunSpec): Promise<AgentResult> {
    return Promise.resolve(ok(spec));
  }
}

let counter = 0;
const seqUuid = () => `id-${(counter++).toString().padStart(4, "0")}`;

beforeEach(() => {
  counter = 0;
});

describe("Orchestrator — happy path", () => {
  it("runs codegen -> test -> review and ends in review with aggregated cost", async () => {
    const store = new InMemoryStateStore();
    const orch = new Orchestrator(store, new AlwaysOkRuntime(), { uuid: seqUuid });
    const req = baseRequest();
    await store.create("task-1", req);
    await orch.execute("task-1", req);

    const state = await store.get("task-1");
    expect(state?.status).toBe("review");
    expect(Object.keys(state!.results)).toHaveLength(3);
    expect(state!.cost?.totalTokens).toBe(45);
  });
});

describe("Orchestrator — self-heal", () => {
  it("retries a failed subtask and proceeds when the retry succeeds", async () => {
    let codegenCalls = 0;
    const runtime: AgentRuntime = {
      async runAgent(spec) {
        if (spec.subtask.agentType === "codegen") {
          codegenCalls += 1;
          if (codegenCalls === 1) {
            return {
              ...ok(spec),
              success: false,
              error: "boom",
              output: { files: {}, summary: "" },
            };
          }
        }
        return ok(spec);
      },
    };
    const store = new InMemoryStateStore();
    const orch = new Orchestrator(store, runtime, { uuid: seqUuid });
    const req = baseRequest();
    await store.create("task-2", req);
    await orch.execute("task-2", req);

    const state = await store.get("task-2");
    expect(state?.status).toBe("review");
    expect(codegenCalls).toBeGreaterThanOrEqual(2);
    expect(Object.values(state!.results).every((r) => r.success)).toBe(true);
  });

  it("fails the task when self-heal exhausts retries", async () => {
    const runtime: AgentRuntime = {
      async runAgent(spec) {
        if (spec.subtask.agentType === "codegen") {
          return {
            ...ok(spec),
            success: false,
            error: "always fails",
            output: { files: {}, summary: "" },
          };
        }
        return ok(spec);
      },
    };
    const store = new InMemoryStateStore();
    const orch = new Orchestrator(store, runtime, { uuid: seqUuid, maxAgentRetries: 2 });
    const req = baseRequest();
    await store.create("task-3", req);
    await orch.execute("task-3", req);

    const state = await store.get("task-3");
    expect(state?.status).toBe("failed");
  });
});

describe("Orchestrator — review flow", () => {
  async function reviewable(id: string) {
    const store = new InMemoryStateStore();
    const orch = new Orchestrator(store, new AlwaysOkRuntime(), { uuid: seqUuid });
    const req = baseRequest();
    await store.create(id, req);
    await orch.execute(id, req);
    return { store, orch };
  }

  it("approve -> completed", async () => {
    const { store, orch } = await reviewable("t-approve");
    const res = await orch.review("t-approve", { taskId: "t-approve", decision: "approve" });
    expect(res).toEqual({ status: "approved" });
    expect((await store.get("t-approve"))?.status).toBe("completed");
  });

  it("reject -> failed with reviewer message", async () => {
    const { store, orch } = await reviewable("t-reject");
    const res = await orch.review("t-reject", {
      taskId: "t-reject",
      decision: "reject",
      feedback: "no",
    });
    expect(res).toEqual({ status: "rejected" });
    const state = await store.get("t-reject");
    expect(state?.status).toBe("failed");
    expect(state?.error).toMatch(/Rejected by reviewer: no/);
  });

  it("revise requires feedback and re-runs the task", async () => {
    const { orch } = await reviewable("t-revise");
    const res = await orch.review("t-revise", {
      taskId: "t-revise",
      decision: "revise",
      feedback: "use async",
    });
    expect(res).toEqual({ status: "revision_requested" });
  });

  it("rejects review when the task is not in review state", async () => {
    const store = new InMemoryStateStore();
    const orch = new Orchestrator(store, new AlwaysOkRuntime(), { uuid: seqUuid });
    await store.create("t-pending", baseRequest());
    const res = await orch.review("t-pending", { taskId: "t-pending", decision: "approve" });
    expect(res).toEqual({ error: "Task is not in review state" });
  });
});

describe("Orchestrator — scheduling", () => {
  const parallelGraph = () => [
    { id: "a", agentType: "codegen" as const, description: "a", context: {}, dependencies: [] },
    { id: "b", agentType: "codegen" as const, description: "b", context: {}, dependencies: [] },
    { id: "c", agentType: "codegen" as const, description: "c", context: {}, dependencies: [] },
  ];

  it("runs independent subtasks concurrently, bounded by maxParallelAgents", async () => {
    let active = 0;
    let peak = 0;
    const runtime: AgentRuntime = {
      async runAgent(spec) {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
        return ok(spec);
      },
    };
    const store = new InMemoryStateStore();
    const orch = new Orchestrator(store, runtime, {
      uuid: seqUuid,
      maxParallelAgents: 2,
      decompose: parallelGraph,
    });
    await store.create("t-par", baseRequest());
    await orch.execute("t-par", baseRequest());
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(2);
    expect((await store.get("t-par"))?.status).toBe("review");
  });

  it("fails the task on a circular dependency", async () => {
    const store = new InMemoryStateStore();
    const orch = new Orchestrator(store, new AlwaysOkRuntime(), {
      uuid: seqUuid,
      decompose: () => [
        { id: "x", agentType: "codegen", description: "x", context: {}, dependencies: ["y"] },
        { id: "y", agentType: "codegen", description: "y", context: {}, dependencies: ["x"] },
      ],
    });
    await store.create("t-circular", baseRequest());
    await orch.execute("t-circular", baseRequest());
    const state = await store.get("t-circular");
    expect(state?.status).toBe("failed");
    expect(state?.error).toMatch(/Circular dependency/);
  });

  it("skips a dependent when its dependency fails", async () => {
    let dependentRan = false;
    const runtime: AgentRuntime = {
      async runAgent(spec) {
        if (spec.subtask.id.startsWith("dep")) dependentRan = true;
        if (spec.subtask.id === "root" || spec.subtask.id.startsWith("root-retry")) {
          return { ...ok(spec), success: false, error: "root failed", output: { files: {}, summary: "" } };
        }
        return ok(spec);
      },
    };
    const store = new InMemoryStateStore();
    const orch = new Orchestrator(store, runtime, {
      uuid: seqUuid,
      maxAgentRetries: 1,
      decompose: () => [
        { id: "root", agentType: "codegen", description: "root", context: {}, dependencies: [] },
        { id: "dependent", agentType: "review", description: "dep", context: {}, dependencies: ["root"] },
      ],
    });
    await store.create("t-skip", baseRequest());
    await orch.execute("t-skip", baseRequest());
    const state = await store.get("t-skip");
    expect(state?.status).toBe("failed");
    expect(dependentRan).toBe(false);
    expect(state?.results["dependent"]?.error).toMatch(/dependency failed/);
  });

  it("accumulates token cost across self-heal attempts", async () => {
    let calls = 0;
    const runtime: AgentRuntime = {
      async runAgent(spec) {
        calls += 1;
        const base = ok(spec); // cost.totalTokens = 15 per call
        if (calls === 1) {
          return { ...base, success: false, error: "boom", output: { files: {}, summary: "" } };
        }
        return base;
      },
    };
    const store = new InMemoryStateStore();
    const orch = new Orchestrator(store, runtime, {
      uuid: seqUuid,
      decompose: () => [
        { id: "solo", agentType: "codegen", description: "s", context: {}, dependencies: [] },
      ],
    });
    await store.create("t-cost", baseRequest());
    await orch.execute("t-cost", baseRequest());
    const state = await store.get("t-cost");
    expect(state?.status).toBe("review");
    // Failed attempt (15) + successful retry (15) both counted.
    expect(state?.results["solo"]?.cost.totalTokens).toBe(30);
  });
});

describe("Orchestrator — usage", () => {
  it("records cost so getUsage aggregates it", async () => {
    const store = new InMemoryStateStore();
    const orch = new Orchestrator(store, new AlwaysOkRuntime(), { uuid: seqUuid });
    const req = baseRequest();
    await store.create("t-usage", req);
    await orch.execute("t-usage", req);
    const usage = await orch.getUsage();
    expect(usage.tasks).toHaveLength(1);
    expect(usage.aggregate.totalTokens).toBe(45);
  });
});
