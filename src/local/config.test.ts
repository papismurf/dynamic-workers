import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("defaults to openai/gpt-4o", () => {
    const cfg = loadConfig({} as NodeJS.ProcessEnv);
    expect(cfg.llm.provider).toBe("openai");
    expect(cfg.llm.model).toBe("gpt-4o");
    expect(cfg.port).toBe(8787);
    expect(cfg.maxParallelAgents).toBe(4);
  });

  it("resolves the provider-specific API key", () => {
    const cfg = loadConfig({
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "sk-ant",
    } as NodeJS.ProcessEnv);
    expect(cfg.llm.provider).toBe("anthropic");
    expect(cfg.llm.model).toBe("claude-sonnet-4-20250514");
    expect(cfg.llm.apiKey).toBe("sk-ant");
  });

  it("LLM_API_KEY overrides provider-specific keys", () => {
    const cfg = loadConfig({
      LLM_PROVIDER: "deepseek",
      LLM_API_KEY: "override",
      DEEPSEEK_API_KEY: "ignored",
    } as NodeJS.ProcessEnv);
    expect(cfg.llm.apiKey).toBe("override");
  });

  it("supports self-hosted openai-compatible endpoints with no key", () => {
    const cfg = loadConfig({
      LLM_PROVIDER: "openai-compatible",
      LLM_BASE_URL: "http://localhost:11434/v1",
      LLM_MODEL: "llama3",
      PORT: "9000",
      MAX_PARALLEL_AGENTS: "2",
    } as NodeJS.ProcessEnv);
    expect(cfg.llm.baseUrl).toBe("http://localhost:11434/v1");
    expect(cfg.llm.apiKey).toBe("");
    expect(cfg.port).toBe(9000);
    expect(cfg.maxParallelAgents).toBe(2);
  });
});
