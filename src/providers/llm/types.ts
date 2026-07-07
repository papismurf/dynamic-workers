/**
 * Provider-agnostic LLM layer.
 *
 * These types are runtime-neutral (no `cloudflare:workers` imports) so the
 * same adapters run inside the Cloudflare LLM WorkerEntrypoint binding and in
 * the local Node runtime. See docs/adr/0002-llm-provider-abstraction.md.
 */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatParams {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
}

export interface ChatResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/**
 * A single LLM backend. `chat()` performs exactly one request (no retries);
 * callers decide retry/backoff policy via `withRetry`. Keeping providers
 * single-shot keeps them composable and easy to test.
 */
export interface LlmProvider {
  /** Stable identifier, e.g. "anthropic" | "openai" | "deepseek" | "openai-compatible". */
  readonly id: string;
  /** Human-facing label used in error messages, e.g. "Anthropic". */
  readonly label: string;
  chat(params: ChatParams): Promise<ChatResponse>;
}

/**
 * Configuration used by the registry to build a provider. All fields except
 * `provider` are optional so sensible per-provider defaults can apply.
 */
export interface LlmProviderConfig {
  provider: string;
  apiKey: string;
  model: string;
  /** Override the API base URL (required for self-hosted / OpenAI-compatible). */
  baseUrl?: string;
  /**
   * Injectable fetch. The local runtime passes an egress-guarded fetch here so
   * the domain allowlist is enforced on the actual network call.
   */
  fetchImpl?: typeof fetch;
}
