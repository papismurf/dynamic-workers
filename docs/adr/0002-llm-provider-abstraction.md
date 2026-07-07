# ADR-0002: LLM Provider Abstraction

- Status: Proposed
- Date: 2026-07-07
- Deciders: Orchestrator maintainers
- Related: ADR-0001

## Context

`src/bindings/llm.ts` hardcodes a two-way switch between Anthropic and OpenAI inside a Cloudflare `WorkerEntrypoint`. The provider union is literally `"anthropic" | "openai"`. Users want to use any concurrent-capable backend: Anthropic, OpenAI, DeepSeek, and open-source/self-hosted models (Ollama, vLLM, LM Studio, Together, Groq, etc.).

The good news: the existing code is already plain `fetch()` calls, so ~80% of the adapter layer exists.

## Decision

Define an `LlmProvider` port and a registry:

```ts
interface LlmProvider {
  readonly id: string;
  chat(params: ChatParams): Promise<ChatResponse>; // { content, inputTokens, outputTokens, model }
}
```

Adapters:
- `AnthropicProvider` — `POST /v1/messages` (existing logic, extracted).
- `OpenAiProvider` — `POST /v1/chat/completions` (existing logic, extracted).
- `DeepSeekProvider` — OpenAI-compatible schema, base URL `https://api.deepseek.com`.
- `OpenAiCompatibleProvider` — configurable `baseUrl` for any OpenAI-compatible endpoint (Ollama `/v1`, vLLM, LM Studio, ...).

A `createLlmProvider(config)` factory maps `LLM_PROVIDER` + `LLM_BASE_URL` + `LLM_MODEL` to an adapter. A per-provider pricing table computes `estimatedCostUsd`. Adding a new provider is a small self-contained file (target: under ~100 LOC). Retry/backoff honoring `Retry-After` is applied uniformly.

v1 keeps the existing non-streaming `chat()` contract for maximum cross-provider compatibility; a streaming extension point is noted but deferred.

## Consequences

Positive:
- Any provider that speaks Anthropic-style or OpenAI-style HTTP works out of the box.
- Self-hosted/open-source models are first-class via the OpenAI-compatible adapter.
- Cost tracking generalizes via the pricing table.

Negative / trade-offs:
- Must normalize divergent error/usage shapes; covered by per-provider tests with fixtures.
- Streaming deferred (acceptable for the orchestrated batch model).

Neutral:
- The binding still works inside the Cloudflare runtime (adapter is called from the LLM WorkerEntrypoint) and directly in the local runtime.
