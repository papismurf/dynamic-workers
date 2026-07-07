/**
 * LocalRuntime — runs agents in-process against injected capability bindings.
 *
 * This is the no-Cloudflare execution path: no Worker Loader, no runtime
 * bundler, no Durable Objects. Agents receive only capability objects
 * (`llm`, `fs`) — mirroring the Cloudflare capability model, they cannot make
 * arbitrary network calls because they are never handed a raw `fetch`. See
 * docs/adr/0001-runtime-compute-abstraction.md.
 */
import type { AgentResult, TaskRequest } from "../types.js";
import type { AgentRuntime, AgentRunSpec } from "../core/ports.js";
import { zeroCost } from "../core/state-machine.js";
import { createLlmProvider } from "../providers/llm/registry.js";
import { withRetry } from "../providers/llm/retry.js";
import type { ChatParams, LlmProviderConfig } from "../providers/llm/types.js";
import { EgressPolicy } from "./egress.js";
import {
  getRunner,
  type AgentContext,
  type AgentFs,
} from "../agents/runners.js";

/** Default API hosts per provider, used to seed the egress allowlist. */
const PROVIDER_HOSTS: Record<string, string> = {
  anthropic: "api.anthropic.com",
  openai: "api.openai.com",
  deepseek: "api.deepseek.com",
};

export interface LocalRuntimeConfig {
  /** Base LLM config; per-task `request.config` overrides model/provider. */
  llm: LlmProviderConfig;
  /**
   * Egress allowlist for agent-initiated network calls. Defaults to the
   * configured provider's host (derived from baseUrl or the known provider
   * host). Requests to any other host are rejected.
   */
  allowedDomains?: string[];
}

/** Resolve the set of hosts the LLM call is permitted to reach. */
function resolveAllowedDomains(config: LocalRuntimeConfig): string[] {
  if (config.allowedDomains?.length) return config.allowedDomains;
  if (config.llm.baseUrl) {
    try {
      return [new URL(config.llm.baseUrl).hostname];
    } catch {
      /* fall through to provider default */
    }
  }
  const host = PROVIDER_HOSTS[config.llm.provider.toLowerCase()];
  return host ? [host] : [];
}

/** In-memory filesystem seeded from a task's provided files. */
class InMemoryFileSystem implements AgentFs {
  private readonly store: Map<string, string>;

  constructor(seed: Record<string, string>) {
    this.store = new Map(Object.entries(seed));
  }

  async read(path: string): Promise<string> {
    const value = this.store.get(path);
    if (value === undefined) throw new Error(`File not found: ${path}`);
    return value;
  }

  async write(path: string, content: string): Promise<void> {
    this.store.set(path, content);
  }

  async exists(path: string): Promise<boolean> {
    return this.store.has(path);
  }
}

export class LocalRuntime implements AgentRuntime {
  private readonly guardedFetch: typeof fetch;

  constructor(private readonly config: LocalRuntimeConfig) {
    // Enforce the egress allowlist on every agent-initiated network call.
    // Credentials are attached by the provider itself, so the policy here only
    // gatekeeps destinations (prevents SSRF to arbitrary hosts).
    const policy = new EgressPolicy({
      allowedDomains: resolveAllowedDomains(config),
    });
    this.guardedFetch = policy.guardedFetch();
  }

  private providerConfig(request: TaskRequest): LlmProviderConfig {
    const cfg = request.config ?? {};
    return {
      provider: cfg.provider ?? this.config.llm.provider,
      model: cfg.model ?? this.config.llm.model,
      apiKey: this.config.llm.apiKey,
      baseUrl: this.config.llm.baseUrl,
      fetchImpl: this.guardedFetch,
    };
  }

  async runAgent(spec: AgentRunSpec): Promise<AgentResult> {
    const start = Date.now();
    const { subtask, request, taskId } = spec;
    const providerConfig = this.providerConfig(request);
    const provider = createLlmProvider(providerConfig);
    const cfg = request.config ?? {};

    const fs = new InMemoryFileSystem(request.repo.files);
    const ctx: AgentContext = {
      taskId,
      description: subtask.description,
      files: request.repo.files,
      targetFiles: Object.keys(request.repo.files),
      context: subtask.context,
      model: providerConfig.model,
      llm: {
        chat: (params: ChatParams) =>
          withRetry(
            () =>
              provider.chat({
                ...params,
                maxTokens: params.maxTokens ?? cfg.maxTokens,
                temperature: params.temperature ?? cfg.temperature,
              }),
            `${provider.label}.chat`
          ),
      },
      fs,
      log: (message) =>
        spec.onLog?.({
          level: "log",
          message,
          timestamp: Date.now(),
          workerId: `${taskId}-${subtask.id}`,
          taskId,
        }),
    };

    try {
      const runner = getRunner(subtask.agentType);
      const result = await runner(ctx);
      return {
        subtaskId: subtask.id,
        agentType: subtask.agentType,
        success: result.success,
        output: result.output,
        error: result.error,
        cost: result.cost,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        subtaskId: subtask.id,
        agentType: subtask.agentType,
        success: false,
        output: { files: {}, summary: "" },
        error: err instanceof Error ? err.message : "Unknown error",
        cost: zeroCost(),
        durationMs: Date.now() - start,
      };
    }
  }
}
