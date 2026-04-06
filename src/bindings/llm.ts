import { WorkerEntrypoint } from "cloudflare:workers";

interface LLMProps {
  provider: "anthropic" | "openai";
  model: string;
  apiKey: string;
  taskId: string;
  agentType: string;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatParams {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
}

interface ChatResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * LLM RPC binding — wraps AI provider APIs with managed credentials,
 * retry logic, and token tracking. Agents call `env.LLM.chat(...)`.
 */
export class LLM extends WorkerEntrypoint<Env, LLMProps> {
  private get props() {
    return this.ctx.props;
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const maxTokens = params.maxTokens ?? 4096;
    const temperature = params.temperature ?? 0;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (this.props.provider === "anthropic") {
          return await this.callAnthropic(params.messages, maxTokens, temperature, params.stop);
        }
        return await this.callOpenAI(params.messages, maxTokens, temperature, params.stop);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isRetryable =
          lastError.message.includes("529") ||
          lastError.message.includes("529") ||
          lastError.message.includes("rate") ||
          lastError.message.includes("timeout") ||
          lastError.message.includes("500") ||
          lastError.message.includes("502") ||
          lastError.message.includes("503");

        if (!isRetryable || attempt === MAX_RETRIES - 1) break;

        const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    throw new Error(
      `LLM.chat failed after ${MAX_RETRIES} attempts: ${lastError?.message}`
    );
  }

  private async callAnthropic(
    messages: ChatMessage[],
    maxTokens: number,
    temperature: number,
    stop?: string[]
  ): Promise<ChatResponse> {
    const systemMessages = messages.filter((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model: this.props.model,
      max_tokens: maxTokens,
      temperature,
      messages: chatMessages.map((m) => ({ role: m.role, content: m.content })),
    };

    if (systemMessages.length > 0) {
      body.system = systemMessages.map((m) => m.content).join("\n\n");
    }
    if (stop?.length) {
      body.stop_sequences = stop;
    }

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.props.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Anthropic ${resp.status}: ${errText}`);
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
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      model: data.model,
    };
  }

  private async callOpenAI(
    messages: ChatMessage[],
    maxTokens: number,
    temperature: number,
    stop?: string[]
  ): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: this.props.model,
      max_tokens: maxTokens,
      temperature,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (stop?.length) {
      body.stop = stop;
    }

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.props.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`OpenAI ${resp.status}: ${errText}`);
    }

    const data = (await resp.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
      model: string;
    };

    return {
      content: data.choices[0]?.message.content ?? "",
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
      model: data.model,
    };
  }
}
