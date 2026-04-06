import type { TaskManager } from "./state";
import type { CostTracker } from "./state";
import type { LogSession } from "./observability";

declare global {
  interface Env {
    LOADER: WorkerLoader;

    TASK_MANAGER: DurableObjectNamespace<TaskManager>;
    LOG_SESSION: DurableObjectNamespace<LogSession>;
    COST_TRACKER: DurableObjectNamespace<CostTracker>;

    AGENT_MEMORY: KVNamespace;
    REPO_CREDENTIALS: KVNamespace;

    // Secrets (set via `wrangler secret put`)
    ANTHROPIC_API_KEY: string;
    OPENAI_API_KEY: string;
    GITHUB_PAT: string;

    // Vars from wrangler.jsonc
    DEFAULT_LLM_MODEL: string;
    DEFAULT_LLM_PROVIDER: string;
    MAX_AGENT_RETRIES: string;
    ALLOWED_EGRESS_DOMAINS: string;
  }
}
