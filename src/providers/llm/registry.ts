import type { LlmProvider, LlmProviderConfig } from "./types.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAiCompatibleProvider } from "./openai-compatible.js";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

/**
 * Build an {@link LlmProvider} from configuration. Adding a new provider is a
 * single case here plus (optionally) a pricing entry. Any OpenAI-compatible
 * endpoint (self-hosted or hosted) is supported via the `openai-compatible`
 * provider id with an explicit `baseUrl`.
 */
export function createLlmProvider(config: LlmProviderConfig): LlmProvider {
  const provider = config.provider.toLowerCase();

  switch (provider) {
    case "anthropic":
      return new AnthropicProvider(
        config.apiKey,
        config.model,
        config.baseUrl,
        config.fetchImpl
      );

    case "openai":
      return new OpenAiCompatibleProvider(
        "openai",
        "OpenAI",
        config.apiKey,
        config.model,
        config.baseUrl ?? OPENAI_BASE_URL,
        config.fetchImpl
      );

    case "deepseek":
      return new OpenAiCompatibleProvider(
        "deepseek",
        "DeepSeek",
        config.apiKey,
        config.model,
        config.baseUrl ?? DEEPSEEK_BASE_URL,
        config.fetchImpl
      );

    case "openai-compatible":
    case "ollama":
    case "vllm":
    case "lmstudio":
    case "together":
    case "groq": {
      if (!config.baseUrl) {
        throw new Error(
          `Provider "${provider}" requires a baseUrl (e.g. LLM_BASE_URL=http://localhost:11434/v1)`
        );
      }
      return new OpenAiCompatibleProvider(
        provider,
        provider,
        config.apiKey,
        config.model,
        config.baseUrl,
        config.fetchImpl
      );
    }

    default:
      throw new Error(
        `Unknown LLM provider "${config.provider}". Supported: anthropic, openai, deepseek, openai-compatible (with baseUrl).`
      );
  }
}

/** Provider ids recognised by {@link createLlmProvider}. */
export const KNOWN_PROVIDERS = [
  "anthropic",
  "openai",
  "deepseek",
  "openai-compatible",
] as const;
