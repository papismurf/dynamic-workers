/**
 * LLM binding tests — provider routing, credential placement, retry/backoff
 * semantics. fetch is stubbed via the route-matcher; jest fake timers advance
 * the exponential-backoff sleeps without real wall-clock waits.
 */
import { LLM } from "./llm.js";
import {
  createFetchMock,
  jsonResponse,
  textResponse,
} from "../../tests/helpers/fetch.js";

function makeLLM(provider: "anthropic" | "openai", apiKey = "secret") {
  return new LLM(
    {
      props: {
        provider,
        model: provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o",
        apiKey,
        taskId: "t-1",
        agentType: "codegen",
      },
      storage: undefined,
    } as never,
    {} as never
  );
}

describe("LLM.chat — Anthropic", () => {
  it("POSTs to /v1/messages with x-api-key header and system message", async () => {
    const fx = createFetchMock().on(
      "POST https://api.anthropic.com/v1/messages",
      (_req, call) => {
        expect(call.headers["x-api-key"]).toBe("sk-ant-xxx");
        expect(call.headers["anthropic-version"]).toBe("2023-06-01");
        const body = JSON.parse(call.body ?? "{}") as {
          system?: string;
          messages: Array<{ role: string; content: string }>;
        };
        expect(body.system).toBe("you are helpful");
        expect(body.messages).toEqual([
          { role: "user", content: "hi" },
        ]);
        return jsonResponse({
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 10, output_tokens: 5 },
          model: "claude-sonnet-4-20250514",
        });
      }
    );
    fx.install();
    try {
      const llm = makeLLM("anthropic", "sk-ant-xxx");
      const res = await llm.chat({
        messages: [
          { role: "system", content: "you are helpful" },
          { role: "user", content: "hi" },
        ],
      });
      expect(res).toEqual({
        content: "ok",
        inputTokens: 10,
        outputTokens: 5,
        model: "claude-sonnet-4-20250514",
      });
    } finally {
      fx.restore();
    }
  });

  it("joins multiple system messages with a blank line", async () => {
    let captured: string | undefined;
    const fx = createFetchMock().on(
      "POST https://api.anthropic.com/v1/messages",
      (_req, call) => {
        captured = (JSON.parse(call.body ?? "{}") as { system?: string }).system;
        return jsonResponse({
          content: [{ type: "text", text: "" }],
          usage: { input_tokens: 0, output_tokens: 0 },
          model: "x",
        });
      }
    );
    fx.install();
    try {
      const llm = makeLLM("anthropic");
      await llm.chat({
        messages: [
          { role: "system", content: "a" },
          { role: "system", content: "b" },
          { role: "user", content: "u" },
        ],
      });
      expect(captured).toBe("a\n\nb");
    } finally {
      fx.restore();
    }
  });
});

describe("LLM.chat — OpenAI", () => {
  it("POSTs to /v1/chat/completions with Authorization: Bearer", async () => {
    const fx = createFetchMock().on(
      "POST https://api.openai.com/v1/chat/completions",
      (_req, call) => {
        expect(call.headers["authorization"]).toBe("Bearer sk-openai-xxx");
        return jsonResponse({
          choices: [{ message: { content: "hi" } }],
          usage: { prompt_tokens: 3, completion_tokens: 7 },
          model: "gpt-4o",
        });
      }
    );
    fx.install();
    try {
      const llm = makeLLM("openai", "sk-openai-xxx");
      const res = await llm.chat({
        messages: [{ role: "user", content: "u" }],
      });
      expect(res.content).toBe("hi");
      expect(res.inputTokens).toBe(3);
      expect(res.outputTokens).toBe(7);
    } finally {
      fx.restore();
    }
  });
});

describe("LLM.chat — retry semantics", () => {
  it("retries on 429/503 with exponential backoff", async () => {
    jest.useFakeTimers();
    try {
      let attempts = 0;
      const fx = createFetchMock().on(
        "POST https://api.openai.com/v1/chat/completions",
        () => {
          attempts += 1;
          if (attempts < 3) return textResponse("rate limited", 503);
          return jsonResponse({
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
            model: "gpt-4o",
          });
        }
      );
      fx.install();
      const llm = makeLLM("openai");
      const p = llm.chat({ messages: [{ role: "user", content: "u" }] });
      // Advance through both sleeps (1s + 2s base delays + jitter <500ms).
      await jest.advanceTimersByTimeAsync(4_000);
      const res = await p;
      expect(res.content).toBe("ok");
      expect(attempts).toBe(3);
      fx.restore();
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not retry on non-retryable (e.g. 400) errors", async () => {
    let attempts = 0;
    const fx = createFetchMock().on(
      "POST https://api.openai.com/v1/chat/completions",
      () => {
        attempts += 1;
        return textResponse("bad request", 400);
      }
    );
    fx.install();
    try {
      const llm = makeLLM("openai");
      await expect(
        llm.chat({ messages: [{ role: "user", content: "u" }] })
      ).rejects.toThrow(/OpenAI 400/);
      expect(attempts).toBe(1);
    } finally {
      fx.restore();
    }
  });

  it("gives up after MAX_RETRIES attempts on persistent retryable errors", async () => {
    jest.useFakeTimers();
    try {
      let attempts = 0;
      const fx = createFetchMock().on(
        "POST https://api.openai.com/v1/chat/completions",
        () => {
          attempts += 1;
          return textResponse("timeout", 503);
        }
      );
      fx.install();
      const llm = makeLLM("openai");
      const p = llm.chat({ messages: [{ role: "user", content: "u" }] });
      p.catch(() => {
        /* assert below */
      });
      await jest.advanceTimersByTimeAsync(10_000);
      await expect(p).rejects.toThrow(/failed after 3 attempts/);
      expect(attempts).toBe(3);
      fx.restore();
    } finally {
      jest.useRealTimers();
    }
  });
});
