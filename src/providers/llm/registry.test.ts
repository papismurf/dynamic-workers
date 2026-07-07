/**
 * Provider registry + adapter tests. fetch is stubbed via the shared route
 * matcher; these assert the wire format (URL, headers, body) each provider
 * produces and that the registry selects the right adapter.
 */
import { createLlmProvider } from "./registry.js";
import {
  createFetchMock,
  jsonResponse,
  textResponse,
} from "../../../tests/helpers/fetch.js";

describe("createLlmProvider — selection", () => {
  it("throws on an unknown provider", () => {
    expect(() =>
      createLlmProvider({ provider: "nope", apiKey: "k", model: "m" })
    ).toThrow(/Unknown LLM provider/);
  });

  it("requires a baseUrl for openai-compatible providers", () => {
    expect(() =>
      createLlmProvider({ provider: "ollama", apiKey: "", model: "llama3" })
    ).toThrow(/requires a baseUrl/);
  });

  it("assigns stable ids/labels", () => {
    expect(createLlmProvider({ provider: "anthropic", apiKey: "k", model: "m" }).id).toBe("anthropic");
    expect(createLlmProvider({ provider: "openai", apiKey: "k", model: "m" }).id).toBe("openai");
    expect(createLlmProvider({ provider: "deepseek", apiKey: "k", model: "m" }).id).toBe("deepseek");
  });
});

describe("AnthropicProvider", () => {
  it("POSTs to /v1/messages with x-api-key and hoisted system message", async () => {
    const fx = createFetchMock().on(
      "POST https://api.anthropic.com/v1/messages",
      (_req, call) => {
        expect(call.headers["x-api-key"]).toBe("sk-ant");
        expect(call.headers["anthropic-version"]).toBe("2023-06-01");
        const body = JSON.parse(call.body ?? "{}") as {
          system?: string;
          messages: Array<{ role: string; content: string }>;
        };
        expect(body.system).toBe("sys");
        expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
        return jsonResponse({
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 4, output_tokens: 2 },
          model: "claude-sonnet-4-20250514",
        });
      }
    );
    fx.install();
    try {
      const p = createLlmProvider({
        provider: "anthropic",
        apiKey: "sk-ant",
        model: "claude-sonnet-4-20250514",
      });
      const res = await p.chat({
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "hi" },
        ],
      });
      expect(res).toEqual({
        content: "ok",
        inputTokens: 4,
        outputTokens: 2,
        model: "claude-sonnet-4-20250514",
      });
    } finally {
      fx.restore();
    }
  });

  it("surfaces API errors with a provider-labelled message", async () => {
    const fx = createFetchMock().on(
      "POST https://api.anthropic.com/v1/messages",
      () => textResponse("bad", 400)
    );
    fx.install();
    try {
      const p = createLlmProvider({ provider: "anthropic", apiKey: "k", model: "m" });
      await expect(p.chat({ messages: [{ role: "user", content: "u" }] })).rejects.toThrow(
        /Anthropic 400/
      );
    } finally {
      fx.restore();
    }
  });
});

describe("OpenAI-compatible providers", () => {
  it("openai POSTs to api.openai.com/v1 with Bearer auth", async () => {
    const fx = createFetchMock().on(
      "POST https://api.openai.com/v1/chat/completions",
      (_req, call) => {
        expect(call.headers["authorization"]).toBe("Bearer sk-openai");
        return jsonResponse({
          choices: [{ message: { content: "hey" } }],
          usage: { prompt_tokens: 3, completion_tokens: 7 },
          model: "gpt-4o",
        });
      }
    );
    fx.install();
    try {
      const p = createLlmProvider({ provider: "openai", apiKey: "sk-openai", model: "gpt-4o" });
      const res = await p.chat({ messages: [{ role: "user", content: "u" }] });
      expect(res.content).toBe("hey");
      expect(res.inputTokens).toBe(3);
      expect(res.outputTokens).toBe(7);
    } finally {
      fx.restore();
    }
  });

  it("deepseek POSTs to the DeepSeek base URL", async () => {
    const fx = createFetchMock().on(
      "POST https://api.deepseek.com/v1/chat/completions",
      () =>
        jsonResponse({
          choices: [{ message: { content: "d" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: "deepseek-chat",
        })
    );
    fx.install();
    try {
      const p = createLlmProvider({ provider: "deepseek", apiKey: "k", model: "deepseek-chat" });
      const res = await p.chat({ messages: [{ role: "user", content: "u" }] });
      expect(res.content).toBe("d");
    } finally {
      fx.restore();
    }
  });

  it("self-hosted (openai-compatible) uses the given baseUrl and omits auth when key is empty", async () => {
    const fx = createFetchMock().on(
      "POST http://localhost:11434/v1/chat/completions",
      (_req, call) => {
        expect(call.headers["authorization"]).toBeUndefined();
        return jsonResponse({
          choices: [{ message: { content: "local" } }],
          usage: { prompt_tokens: 0, completion_tokens: 0 },
          model: "llama3",
        });
      }
    );
    fx.install();
    try {
      const p = createLlmProvider({
        provider: "openai-compatible",
        apiKey: "",
        model: "llama3",
        baseUrl: "http://localhost:11434/v1",
      });
      const res = await p.chat({ messages: [{ role: "user", content: "u" }] });
      expect(res.content).toBe("local");
    } finally {
      fx.restore();
    }
  });
});
