/**
 * Test env factory — composes the individual fakes into an object shaped
 * like the real `Env` exposed to the orchestrator Worker.
 *
 * Tests that only need a piece can still construct it directly from kv.ts
 * / do.ts / loader.ts; this factory is the batteries-included path used by
 * the router and integration suites.
 */

import { TaskManager, CostTracker } from "../../src/state.js";
import { LogSession } from "../../src/observability.js";
import type { AgentRunFn } from "./loader.js";
import { createFakeLoader } from "./loader.js";
import { createFakeKV, type FakeKV } from "./kv.js";
import { createDONamespace } from "./do.js";
import { createClock, type Clock } from "./clock.js";
import { createExecutionContext, type FakeExecutionContext } from "./ctx.js";
import { createFetchMock, type FetchMock } from "./fetch.js";
import { exports as workerExports, resetExports } from "./cloudflare-workers.js";

export interface TestEnvHandle {
  env: Env;
  ctx: FakeExecutionContext;
  kv: { AGENT_MEMORY: FakeKV; REPO_CREDENTIALS: FakeKV };
  clock: Clock;
  fetchMock: FetchMock;
  /** Tear down: restore fetch + clear the `exports` registry. */
  dispose(): void;
}

export interface TestEnvOptions {
  /** Override env vars. Defaults come from wrangler.jsonc. */
  vars?: Partial<Env>;
  /** Pre-register entrypoints on the fake LOADER binding. */
  agentEntrypoints?: Record<string, AgentRunFn>;
  /** Install the fetch mock now (default: true). */
  installFetch?: boolean;
}

const DEFAULT_VARS = {
  DEFAULT_LLM_MODEL: "claude-sonnet-4-20250514",
  DEFAULT_LLM_PROVIDER: "anthropic",
  MAX_AGENT_RETRIES: "3",
  ALLOWED_EGRESS_DOMAINS:
    "api.anthropic.com,api.openai.com,api.github.com,registry.npmjs.org",
  ANTHROPIC_API_KEY: "sk-ant-test",
  OPENAI_API_KEY: "sk-openai-test",
  GITHUB_PAT: "ghp_test",
} as const;

export function createTestEnv(options: TestEnvOptions = {}): TestEnvHandle {
  const clock = createClock();
  const ctx = createExecutionContext();
  const fetchMock = createFetchMock();
  if (options.installFetch !== false) fetchMock.install();

  const AGENT_MEMORY = createFakeKV(clock);
  const REPO_CREDENTIALS = createFakeKV(clock);

  // Durable Object namespaces. The fake ties each name to a long-lived
  // instance, so repeated `env.TASK_MANAGER.get(id)` lookups return the
  // same state — matching real DO semantics.
  const TASK_MANAGER = createDONamespace(TaskManager, {});
  const COST_TRACKER = createDONamespace(CostTracker, {});
  const LOG_SESSION = createDONamespace(LogSession, {});

  // `exports` wiring so observability.ts can resolve sibling services by
  // name. We expose LogSession as a getByName-style lookup; the default
  // orchestrator code reaches for LogSession.getByName(workerId).
  const logExport = {
    getByName(name: string) {
      return LOG_SESSION.get(LOG_SESSION.idFromName(name));
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (workerExports as any).LogSession = logExport;

  // LOADER: by default no agents registered — tests opt in.
  const LOADER = createFakeLoader(options.agentEntrypoints ?? {});

  const env = {
    ...DEFAULT_VARS,
    ...options.vars,
    TASK_MANAGER,
    COST_TRACKER,
    LOG_SESSION,
    AGENT_MEMORY,
    REPO_CREDENTIALS,
    LOADER: LOADER.binding,
  } as unknown as Env;

  return {
    env,
    ctx,
    kv: { AGENT_MEMORY, REPO_CREDENTIALS },
    clock,
    fetchMock,
    dispose() {
      fetchMock.restore();
      resetExports();
    },
  };
}
