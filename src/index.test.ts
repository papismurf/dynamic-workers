/**
 * Router tests for the orchestrator Worker. These drive default.fetch()
 * directly with fake env + ctx, asserting on HTTP responses and DO side
 * effects. Heavy flows (executeTask waitUntil work) are covered in the
 * integration suite; here we verify the surface-level routing table, status
 * codes, input validation, and path dispatch only.
 */
import orchestrator from "./index.js";
import { createTestEnv, type TestEnvHandle } from "../tests/helpers/env.js";
import type { CreateTaskRequest, ReviewDecision } from "./types.js";

let harness: TestEnvHandle;

beforeEach(() => {
  harness = createTestEnv({
    // POST /tasks waitUntil triggers runAgent — register the codegen
    // entrypoint as a stable success so background work doesn't crash.
    agentEntrypoints: {
      CodeGenAgent: async () =>
        JSON.stringify({ success: true, files: {}, summary: "ok" }),
      TestAgent: async () =>
        JSON.stringify({ success: true, files: {}, summary: "ok" }),
      ReviewAgent: async () =>
        JSON.stringify({
          success: true,
          files: {},
          summary: "ok",
          reviewComments: [],
        }),
    },
  });
});

afterEach(() => {
  harness.dispose();
});

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`https://worker${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  it("returns a healthy JSON payload", async () => {
    const resp = await orchestrator.fetch(req("GET", "/health"), harness.env, harness.ctx);
    expect(resp.status).toBe(200);
    expect(await resp.json()).toMatchObject({
      service: "agent-orchestrator",
      status: "healthy",
    });
  });

  it("/ is an alias for /health", async () => {
    const resp = await orchestrator.fetch(req("GET", "/"), harness.env, harness.ctx);
    expect(resp.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /tasks
// ---------------------------------------------------------------------------

describe("POST /tasks", () => {
  const validBody: CreateTaskRequest = {
    tasks: [
      {
        description: "Add a pure utility",
        agentType: "codegen",
        repo: {
          owner: "acme",
          repo: "api",
          branch: "agent/x",
          baseBranch: "main",
          files: {},
        },
      },
    ],
  };

  it("returns 201 and a taskIds array on valid input", async () => {
    const resp = await orchestrator.fetch(
      req("POST", "/tasks", validBody),
      harness.env,
      harness.ctx
    );
    expect(resp.status).toBe(201);
    const body = (await resp.json()) as { taskIds: string[] };
    expect(body.taskIds).toHaveLength(1);
    expect(body.taskIds[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects an empty tasks array with 400", async () => {
    const resp = await orchestrator.fetch(
      req("POST", "/tasks", { tasks: [] }),
      harness.env,
      harness.ctx
    );
    expect(resp.status).toBe(400);
  });

  it("produces an internal_error 500 on malformed JSON", async () => {
    const bad = new Request("https://worker/tasks", {
      method: "POST",
      body: "{not-json",
      headers: { "content-type": "application/json" },
    });
    const resp = await orchestrator.fetch(bad, harness.env, harness.ctx);
    expect(resp.status).toBe(500);
    expect(await resp.json()).toMatchObject({ error: "internal_error" });
  });
});

// ---------------------------------------------------------------------------
// GET /tasks/:id
// ---------------------------------------------------------------------------

describe("GET /tasks/:id", () => {
  it("returns the task state after creation", async () => {
    // Create
    const created = await orchestrator.fetch(
      req("POST", "/tasks", {
        tasks: [
          {
            description: "x",
            agentType: "codegen",
            repo: {
              owner: "a",
              repo: "b",
              branch: "c",
              baseBranch: "main",
              files: {},
            },
          },
        ],
      } satisfies CreateTaskRequest),
      harness.env,
      harness.ctx
    );
    const { taskIds } = (await created.json()) as { taskIds: string[] };
    const taskId = taskIds[0]!;

    const resp = await orchestrator.fetch(
      req("GET", `/tasks/${taskId}`),
      harness.env,
      harness.ctx
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { task: { id: string } };
    expect(body.task.id).toBe(taskId);
  });
});

// ---------------------------------------------------------------------------
// POST /tasks/:id/review
// ---------------------------------------------------------------------------

describe("POST /tasks/:id/review", () => {
  async function createReviewableTask(): Promise<string> {
    const taskId = crypto.randomUUID();
    const id = harness.env.TASK_MANAGER.idFromName(taskId);
    const stub = harness.env.TASK_MANAGER.get(id) as unknown as {
      initialize(id: string, req: unknown): Promise<unknown>;
      transition(s: string): Promise<void>;
    };
    await stub.initialize(taskId, {
      description: "x",
      agentType: "codegen",
      repo: {
        owner: "a",
        repo: "b",
        branch: "c",
        baseBranch: "main",
        files: {},
      },
    });
    await stub.transition("assigned");
    await stub.transition("running");
    await stub.transition("review");
    return taskId;
  }

  it("approve transitions to approved and returns 200", async () => {
    const taskId = await createReviewableTask();
    const resp = await orchestrator.fetch(
      req("POST", `/tasks/${taskId}/review`, {
        taskId,
        decision: "approve",
      } satisfies ReviewDecision),
      harness.env,
      harness.ctx
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ status: "approved" });
  });

  it("reject transitions to failed with a reviewer message", async () => {
    const taskId = await createReviewableTask();
    const resp = await orchestrator.fetch(
      req("POST", `/tasks/${taskId}/review`, {
        taskId,
        decision: "reject",
        feedback: "not ready",
      } satisfies ReviewDecision),
      harness.env,
      harness.ctx
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ status: "rejected" });
  });

  it("revise requires feedback and kicks off a new execution", async () => {
    const taskId = await createReviewableTask();
    const resp = await orchestrator.fetch(
      req("POST", `/tasks/${taskId}/review`, {
        taskId,
        decision: "revise",
        feedback: "use async/await",
      } satisfies ReviewDecision),
      harness.env,
      harness.ctx
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ status: "revision_requested" });
  });

  it("400 if task is not in review state", async () => {
    // Task is in 'pending' immediately after initialize.
    const taskId = crypto.randomUUID();
    const stub = harness.env.TASK_MANAGER.get(
      harness.env.TASK_MANAGER.idFromName(taskId)
    ) as unknown as {
      initialize(id: string, req: unknown): Promise<unknown>;
    };
    await stub.initialize(taskId, {
      description: "x",
      agentType: "codegen",
      repo: {
        owner: "a",
        repo: "b",
        branch: "c",
        baseBranch: "main",
        files: {},
      },
    });

    const resp = await orchestrator.fetch(
      req("POST", `/tasks/${taskId}/review`, {
        taskId,
        decision: "approve",
      } satisfies ReviewDecision),
      harness.env,
      harness.ctx
    );
    expect(resp.status).toBe(400);
  });

  it("400 on an invalid decision value", async () => {
    const taskId = await createReviewableTask();
    const resp = await orchestrator.fetch(
      req("POST", `/tasks/${taskId}/review`, {
        taskId,
        decision: "burninate",
      }),
      harness.env,
      harness.ctx
    );
    expect(resp.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /usage
// ---------------------------------------------------------------------------

describe("GET /usage", () => {
  it("returns an empty aggregate when no tasks recorded", async () => {
    const resp = await orchestrator.fetch(
      req("GET", "/usage"),
      harness.env,
      harness.ctx
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { tasks: unknown[]; aggregate: { totalTokens: number } };
    expect(body.tasks).toEqual([]);
    expect(body.aggregate.totalTokens).toBe(0);
  });

  it("accepts a `since` query parameter", async () => {
    const resp = await orchestrator.fetch(
      req("GET", "/usage?since=1000"),
      harness.env,
      harness.ctx
    );
    expect(resp.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// WS /tasks/:id/stream
// ---------------------------------------------------------------------------

describe("WS /tasks/:id/stream", () => {
  it("delegates to the LogSession DO with the Upgrade header", async () => {
    // Can't construct a real websocket client here — we verify the router
    // routes to the DO and returns a 101-style response from it.
    const r = new Request("https://worker/tasks/abc/stream", {
      headers: { Upgrade: "websocket" },
    });
    const resp = await orchestrator.fetch(r, harness.env, harness.ctx);
    expect(resp.status).toBe(101);
  });
});

// ---------------------------------------------------------------------------
// 404
// ---------------------------------------------------------------------------

describe("unknown paths", () => {
  it("returns 404 for a path not in the router", async () => {
    const resp = await orchestrator.fetch(
      req("GET", "/does-not-exist"),
      harness.env,
      harness.ctx
    );
    expect(resp.status).toBe(404);
  });

  it("returns 404 for a stream path without the Upgrade header (falls through)", async () => {
    const resp = await orchestrator.fetch(
      req("GET", "/tasks/abc/stream"),
      harness.env,
      harness.ctx
    );
    expect(resp.status).toBe(404);
  });
});
