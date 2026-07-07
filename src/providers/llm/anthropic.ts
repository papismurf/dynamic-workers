import type {
  ChatParams,
  ChatResponse,
  LlmProvider,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Anthropic Messages API adapter (`POST /v1/messages`). System messages are
 * hoisted into the top-level `system` field, as the API requires.
 */
export class AnthropicProvider implements LlmProvider {
  readonly id = "anthropic";
  readonly label = "Anthropic";

  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    baseUrl: string = DEFAULT_BASE_URL
  ) {
    // Normalize so a configured baseUrl with a trailing slash doesn't yield `//`.
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const maxTokens = params.maxTokens ?? 4096;
    const temperature = params.temperature ?? 0;

    const systemMessages = params.messages.filter((m) => m.role === "system");
    const chatMessages = params.messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: maxTokens,
      temperature,
      messages: chatMessages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (systemMessages.length > 0) {
      body.system = systemMessages.map((m) => m.content).join("\n\n");
    }
    if (params.stop?.length) {
      body.stop_sequences = params.stop;
    }

    const resp = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`${this.label} ${resp.status}: ${errText}`);
    }

    const data = (await resp.json()) as {
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
      model: string;
    };

    const text = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    return {
      content: text,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      model: data.model,
    };
  }
}
