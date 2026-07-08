/**
 * LocalRuntime tests — verify an agent runs in-process against a stubbed LLM
 * endpoint, writes generated files, and reports cost, with no Cloudflare
 * primitives involved.
 */
import { LocalRuntime } from "./local.js";
import type { TaskRequest } from "../types.js";
import {
  createFetchMock,
  jsonResponse,
} from "../../tests/helpers/fetch.js";

function request(): TaskRequest {
  return {
    description: "Add a sum function",
    agentType: "codegen",
    repo: { owner: "a", repo: "b", branch: "c", baseBranch: "main", files: {} },
    config: { provider: "openai", model: "gpt-4o" },
  };
}

describe("LocalRuntime", () => {
  it("runs a codegen agent end-to-end against a stubbed OpenAI endpoint", async () => {
    const fx = createFetchMock().on(
      "POST https://api.openai.com/v1/chat/completions",
      () =>
        jsonResponse({
          choices: [
            {
              message: {
                content:
                  "```filepath:src/sum.ts\nexport const sum = (a:number,b:number)=>a+b;\n```",
              },
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 30 },
          model: "gpt-4o",
        })
    );
    fx.install();
    try {
      const runtime = new LocalRuntime({
        llm: { provider: "openai", apiKey: "sk-test", model: "gpt-4o" },
      });
      const result = await runtime.runAgent({
        taskId: "t-local",
        subtask: {
          id: "s1",
          agentType: "codegen",
          description: "Add a sum function",
          context: {},
          dependencies: [],
        },
        request: request(),
      });

      expect(result.success).toBe(true);
      expect(result.output.files["src/sum.ts"]).toContain("export const sum");
      expect(result.cost.totalTokens).toBe(50);
      // gpt-4o pricing: (20*2.5 + 30*10)/1e6
      expect(result.cost.estimatedCostUsd).toBeCloseTo((20 * 2.5 + 30 * 10) / 1e6);
    } finally {
      fx.restore();
    }
  });

  it("enforces the egress allowlist — a disallowed host is blocked", async () => {
    const fx = createFetchMock().on(
      "POST https://api.openai.com/v1/chat/completions",
      () =>
        jsonResponse({
          choices: [{ message: { content: "should not reach here" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: "gpt-4o",
        })
    );
    fx.install();
    try {
      const runtime = new LocalRuntime({
        llm: { provider: "openai", apiKey: "sk-test", model: "gpt-4o" },
        // Allowlist does NOT include api.openai.com.
        allowedDomains: ["example.com"],
      });
      const result = await runtime.runAgent({
        taskId: "t-egress",
        subtask: { id: "s1", agentType: "codegen", description: "x", context: {}, dependencies: [] },
        request: request(),
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not permitted/);
      // The guarded fetch threw before any network call was made.
      expect(fx.calls).toHaveLength(0);
    } finally {
      fx.restore();
    }
  });

  it("derives the egress allowlist from a custom baseUrl host", async () => {
    const fx = createFetchMock().on(
      "POST https://llm.internal.example/v1/chat/completions",
      () =>
        jsonResponse({
          choices: [
            {
              message: {
                content: "```filepath:out.ts\nexport const x = 1;\n```",
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 5 },
          model: "local-model",
        })
    );
    fx.install();
    try {
      const runtime = new LocalRuntime({
        // No explicit allowedDomains — it must be derived from baseUrl.
        llm: {
          provider: "openai-compatible",
          apiKey: "sk-test",
          model: "local-model",
          baseUrl: "https://llm.internal.example/v1",
        },
      });
      const result = await runtime.runAgent({
        taskId: "t-baseurl",
        subtask: { id: "s1", agentType: "codegen", description: "x", context: {}, dependencies: [] },
        request: {
          description: "x",
          agentType: "codegen",
          repo: { owner: "a", repo: "b", branch: "c", baseBranch: "main", files: {} },
          config: { provider: "openai-compatible", model: "local-model" },
        },
      });
      expect(result.success).toBe(true);
      expect(fx.calls).toHaveLength(1);
    } finally {
      fx.restore();
    }
  });

  it("returns a failed result (not a throw) when the agent produces no code", async () => {
    const fx = createFetchMock().on(
      "POST https://api.openai.com/v1/chat/completions",
      () =>
        jsonResponse({
          choices: [{ message: { content: "no code here" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: "gpt-4o",
        })
    );
    fx.install();
    try {
      const runtime = new LocalRuntime({
        llm: { provider: "openai", apiKey: "sk-test", model: "gpt-4o" },
      });
      const result = await runtime.runAgent({
        taskId: "t-local-2",
        subtask: {
          id: "s1",
          agentType: "codegen",
          description: "x",
          context: {},
          dependencies: [],
        },
        request: request(),
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no code output/);
    } finally {
      fx.restore();
    }
  });
});
