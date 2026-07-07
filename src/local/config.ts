/**
 * Environment-driven configuration for the local (no-Cloudflare) runtime.
 * See examples/.env.example and docs for the full variable list.
 */
import type { LlmProviderConfig } from "../providers/llm/types.js";

export interface LocalConfig {
  port: number;
  host: string;
  llm: LlmProviderConfig;
  maxParallelAgents: number;
  maxAgentRetries: number;
}

function resolveApiKey(
  provider: string,
  env: NodeJS.ProcessEnv
): string {
  if (env.LLM_API_KEY) return env.LLM_API_KEY;
  switch (provider) {
    case "anthropic":
      return env.ANTHROPIC_API_KEY ?? "";
    case "openai":
      return env.OPENAI_API_KEY ?? "";
    case "deepseek":
      return env.DEEPSEEK_API_KEY ?? "";
    default:
      // Self-hosted / OpenAI-compatible endpoints often need no key.
      return "";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LocalConfig {
  const provider = (env.LLM_PROVIDER ?? "openai").toLowerCase();
  const model =
    env.LLM_MODEL ??
    (provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o");

  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? "127.0.0.1",
    llm: {
      provider,
      model,
      apiKey: resolveApiKey(provider, env),
      baseUrl: env.LLM_BASE_URL,
    },
    maxParallelAgents: Number(env.MAX_PARALLEL_AGENTS ?? 4),
    maxAgentRetries: Number(env.MAX_AGENT_RETRIES ?? 3),
  };
}
