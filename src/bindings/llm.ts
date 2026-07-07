import { WorkerEntrypoint } from "cloudflare:workers";
import { createLlmProvider } from "../providers/llm/registry.js";
import { withRetry } from "../providers/llm/retry.js";
import type {
  ChatParams,
  ChatResponse,
  LlmProvider,
} from "../providers/llm/types.js";

interface LLMProps {
  provider: string;
  model: string;
  apiKey: string;
  taskId: string;
  agentType: string;
  /** Optional base URL override for OpenAI-compatible / self-hosted models. */
  baseUrl?: string;
}

/**
 * LLM RPC binding — wraps the provider-agnostic adapters with managed
 * credentials, retry logic, and token tracking. Agents call `env.LLM.chat(...)`.
 *
 * Provider selection is delegated to `createLlmProvider` and retry/backoff to
 * the shared `withRetry` helper, so this binding supports Anthropic, OpenAI,
 * DeepSeek, and any OpenAI-compatible endpoint without changes here. See
 * docs/adr/0002-llm-provider-abstraction.md.
 */
export class LLM extends WorkerEntrypoint<Env, LLMProps> {
  private get props() {
    return this.ctx.props;
  }

  private buildProvider(): LlmProvider {
    return createLlmProvider({
      provider: this.props.provider,
      model: this.props.model,
      apiKey: this.props.apiKey,
      baseUrl: this.props.baseUrl,
    });
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const provider = this.buildProvider();
    return withRetry(() => provider.chat(params), "LLM.chat");
  }
}
