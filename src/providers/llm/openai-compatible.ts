import type {
  ChatParams,
  ChatResponse,
  LlmProvider,
} from "./types.js";

/**
 * Adapter for any OpenAI Chat Completions-compatible endpoint
 * (`POST {baseUrl}/chat/completions`). This single adapter powers OpenAI,
 * DeepSeek, and self-hosted / open-source servers (Ollama, vLLM, LM Studio,
 * Together, Groq, ...) — only the base URL, model, and label differ.
 *
 * The `baseUrl` is expected to already include the version segment, e.g.
 * "https://api.openai.com/v1" or "http://localhost:11434/v1".
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    readonly id: string,
    readonly label: string,
    private readonly apiKey: string,
    private readonly model: string,
    baseUrl: string,
    fetchImpl: typeof fetch = fetch
  ) {
    // Normalize so a configured baseUrl with a trailing slash doesn't yield `//`.
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const maxTokens = params.maxTokens ?? 4096;
    const temperature = params.temperature ?? 0;

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: maxTokens,
      temperature,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };
    if (params.stop?.length) {
      body.stop = params.stop;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    // Self-hosted servers often need no key; only send Authorization if set.
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const resp = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`${this.label} ${resp.status}: ${errText}`);
    }

    const data = (await resp.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
      model: string;
    };

    return {
      content: data.choices[0]?.message.content ?? "",
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      model: data.model ?? this.model,
    };
  }
}
