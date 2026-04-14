/**
 * Integration: cost tracking. After a full codegen run the /usage endpoint
 * should surface both per-task and aggregate totals matching what each
 * agent emitted.
 */
import orchestrator from "../../src/index.js";
import { createTestEnv, type TestEnvHandle } from "../helpers/env.js";
import type { CreateTaskRequest } from "../../src/types.js";

let harness: TestEnvHandle;

beforeEach(() => {
  harness = createTestEnv({
    agentEntrypoints: {
      CodeGenAgent: async () =>
        JSON.stringify({
          success: true,
          files: {},
          summary: "",
          cost: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            estimatedCostUsd: 0.005,
            cpuTimeMs: 50,
            subrequests: 1,
          },
        }),
      TestAgent: async () =>
        JSON.stringify({
          success: true,
          files: {},
          summary: "",
          cost: {
            inputTokens: 40,
            outputTokens: 20,
            totalTokens: 60,
            estimatedCostUsd: 0.002,
            cpuTimeMs: 30,
            subrequests: 1,
          },
        }),
      ReviewAgent: async () =>
        JSON.stringify({
          success: true,
          files: {},
          summary: "",
          cost: {
            inputTokens: 200,
            outputTokens: 100,
            totalTokens: 300,
            estimatedCostUsd: 0.01,
            cpuTimeMs: 80,
            subrequests: 1,
          },
        }),
    },
  });
});

afterEach(() => {
  harness.dispose();
});

it("accumulates per-subtask cost into /usage aggregate", async () => {
  await orchestrator.fetch(
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

  await harness.ctx.flush();

  const usageResp = await orchestrator.fetch(
    new Request("https://worker/usage"),
    harness.env,
    harness.ctx
  );
  const usage = (await usageResp.json()) as {
    tasks: Array<{ cost: { totalTokens: number } }>;
    aggregate: { totalTokens: number; subrequests: number };
  };

  expect(usage.tasks).toHaveLength(1);
  // Codegen (150) + Test (60) + Review (300) = 510
  expect(usage.aggregate.totalTokens).toBe(510);
  expect(usage.aggregate.subrequests).toBe(3);
});
