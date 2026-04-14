/**
 * Integration: full task lifecycle — create → run → review → approve → PR.
 *
 * Drives the orchestrator's default.fetch through each stage, awaits the
 * background waitUntil() work explicitly, and asserts on the resulting
 * state transitions + the GitHub PR call captured by the fetch mock.
 */
import orchestrator from "../../src/index.js";
import { createTestEnv, type TestEnvHandle } from "../helpers/env.js";
import { jsonResponse } from "../helpers/fetch.js";
import type { CreateTaskRequest } from "../../src/types.js";

let harness: TestEnvHandle;

beforeEach(() => {
  harness = createTestEnv({
    agentEntrypoints: {
      CodeGenAgent: async () =>
        JSON.stringify({
          success: true,
          files: { "src/new.ts": "export const x = 1;" },
          summary: "generated",
          cost: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            estimatedCostUsd: 0.0001,
            cpuTimeMs: 10,
            subrequests: 0,
          },
        }),
      TestAgent: async () =>
        JSON.stringify({
          success: true,
          files: { "src/new.test.ts": "test('ok', () => {})" },
          summary: "tested",
        }),
      ReviewAgent: async () =>
        JSON.stringify({
          success: true,
          files: {},
          summary: "reviewed",
          reviewComments: [],
        }),
    },
  });

  // Stub the PR creation call issued by finalizeTask.
  harness.fetchMock.on(
    "POST https://api.github.com/repos/:owner/:repo/pulls",
    () => jsonResponse({ html_url: "https://github.com/acme/api/pull/1" })
  );
});

afterEach(() => {
  harness.dispose();
});

it("create → run → review → approve → PR created and state completed", async () => {
  const body: CreateTaskRequest = {
    tasks: [
      {
        description: "Add a utility",
        agentType: "codegen",
        repo: {
          owner: "acme",
          repo: "api",
          branch: "agent/x",
          baseBranch: "main",
          files: { "src/old.ts": "// old" },
        },
      },
    ],
  };

  // 1. create
  const createResp = await orchestrator.fetch(
    new Request("https://worker/tasks", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    harness.env,
    harness.ctx
  );
  const { taskIds } = (await createResp.json()) as { taskIds: string[] };
  const taskId = taskIds[0]!;

  // 2. wait for executeTask() (the subtasks → review transition)
  await harness.ctx.flush();

  // Task should now be in review
  const statusResp = await orchestrator.fetch(
    new Request(`https://worker/tasks/${taskId}`),
    harness.env,
    harness.ctx
  );
  const { task } = (await statusResp.json()) as { task: { status: string } };
  expect(task.status).toBe("review");

  // 3. approve
  await orchestrator.fetch(
    new Request(`https://worker/tasks/${taskId}/review`, {
      method: "POST",
      body: JSON.stringify({ taskId, decision: "approve" }),
      headers: { "content-type": "application/json" },
    }),
    harness.env,
    harness.ctx
  );

  // 4. wait for finalizeTask() — PR creation + transition to completed
  await harness.ctx.flush();

  const final = await orchestrator.fetch(
    new Request(`https://worker/tasks/${taskId}`),
    harness.env,
    harness.ctx
  );
  const { task: finalTask } = (await final.json()) as {
    task: { status: string; reviewUrl?: string };
  };
  expect(finalTask.status).toBe("completed");
  expect(finalTask.reviewUrl).toBe("https://github.com/acme/api/pull/1");

  // Exactly one PR call should have been issued.
  const prCalls = harness.fetchMock.calls.filter(
    (c) => c.method === "POST" && c.url.endsWith("/pulls")
  );
  expect(prCalls).toHaveLength(1);
});
