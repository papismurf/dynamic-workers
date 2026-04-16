/**
 * Integration: retry + self-healing. The first CodeGen invocation returns
 * success=false — orchestrator should re-invoke the agent until success
 * (or until MAX_AGENT_RETRIES is exhausted). Jest fake timers skip the
 * exponential-backoff sleeps.
 */
import orchestrator from "../../src/index.js";
import { createTestEnv, type TestEnvHandle } from "../helpers/env.js";
import type { CreateTaskRequest } from "../../src/types.js";

let harness: TestEnvHandle;
let codegenAttempts = 0;

beforeEach(() => {
  codegenAttempts = 0;
  harness = createTestEnv({
    agentEntrypoints: {
      CodeGenAgent: async () => {
        codegenAttempts += 1;
        if (codegenAttempts < 2) {
          return JSON.stringify({
            success: false,
            files: {},
            summary: "",
            error: "syntax error",
          });
        }
        return JSON.stringify({ success: true, files: {}, summary: "fixed" });
      },
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

it("self-heals a codegen failure and proceeds to review", async () => {
  jest.useFakeTimers();
  try {
    const created = await orchestrator.fetch(
      new Request("https://worker/tasks", {
        method: "POST",
        body: JSON.stringify({
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
        headers: { "content-type": "application/json" },
      }),
      harness.env,
      harness.ctx
    );
    const { taskIds } = (await created.json()) as { taskIds: string[] };
    const taskId = taskIds[0]!;

    // Kick the promise queue while advancing timers so the self-heal
    // setTimeout resolves deterministically.
    await jest.advanceTimersByTimeAsync(5_000);
    jest.useRealTimers();
    await harness.ctx.flush();

    const statusResp = await orchestrator.fetch(
      new Request(`https://worker/tasks/${taskId}`),
      harness.env,
      harness.ctx
    );
    const { task } = (await statusResp.json()) as {
      task: { status: string; results: Record<string, { success: boolean }> };
    };

    // Agent was invoked at least twice (initial + retry).
    expect(codegenAttempts).toBeGreaterThanOrEqual(2);
    // Task made it to review (not failed).
    expect(["review", "approved", "completed"]).toContain(task.status);
  } finally {
    if (jest.isMockFunction(setTimeout)) jest.useRealTimers();
  }
});
