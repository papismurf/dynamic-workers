/**
 * Integration: review rejection path. The task ends up in failed state with
 * the reviewer's feedback captured in the error field, and no PR is created.
 */
import orchestrator from "../../src/index.js";
import { createTestEnv, type TestEnvHandle } from "../helpers/env.js";
import type { CreateTaskRequest } from "../../src/types.js";

let harness: TestEnvHandle;

beforeEach(() => {
  harness = createTestEnv({
    agentEntrypoints: {
      CodeGenAgent: async () =>
        JSON.stringify({ success: true, files: {}, summary: "" }),
      TestAgent: async () =>
        JSON.stringify({ success: true, files: {}, summary: "" }),
      ReviewAgent: async () =>
        JSON.stringify({ success: true, files: {}, summary: "" }),
    },
  });
});

afterEach(() => {
  harness.dispose();
});

it("rejected task ends up failed with reviewer feedback, no PR created", async () => {
  const createResp = await orchestrator.fetch(
    new Request("https://worker/tasks", {
      method: "POST",
      body: JSON.stringify({
        tasks: [
          {
            description: "x",
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
      } satisfies CreateTaskRequest),
      headers: { "content-type": "application/json" },
    }),
    harness.env,
    harness.ctx
  );
  const { taskIds } = (await createResp.json()) as { taskIds: string[] };
  const taskId = taskIds[0]!;

  await harness.ctx.flush();

  await orchestrator.fetch(
    new Request(`https://worker/tasks/${taskId}/review`, {
      method: "POST",
      body: JSON.stringify({
        taskId,
        decision: "reject",
        feedback: "signature is wrong",
      }),
      headers: { "content-type": "application/json" },
    }),
    harness.env,
    harness.ctx
  );
  await harness.ctx.flush();

  const final = await orchestrator.fetch(
    new Request(`https://worker/tasks/${taskId}`),
    harness.env,
    harness.ctx
  );
  const { task } = (await final.json()) as {
    task: { status: string; error?: string };
  };
  expect(task.status).toBe("failed");
  expect(task.error).toContain("signature is wrong");

  // No PR request should have fired.
  const prCalls = harness.fetchMock.calls.filter((c) => c.url.endsWith("/pulls"));
  expect(prCalls).toHaveLength(0);
});
