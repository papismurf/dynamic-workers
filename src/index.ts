/**
 * Agent Orchestrator — main entry point.
 *
 * Receives task requests, decomposes them into subtasks, provisions
 * Dynamic Workers with the appropriate agent code and bindings,
 * and aggregates results.
 */

import { exports } from "cloudflare:workers";
import { createWorker } from "@cloudflare/worker-bundler";
import type {
  TaskRequest,
  TaskState,
  SubTask,
  AgentResult,
  CostBreakdown,
  CreateTaskRequest,
  CreateTaskResponse,
  ReviewDecision,
} from "./types";
import { getAgentSource } from "./agents/source";
import type { TaskManager } from "./state";
import type { CostTracker } from "./state";

// Re-export Durable Objects and entrypoints so Wrangler can find them
export { TaskManager, CostTracker } from "./state";
export { LogSession, DynamicWorkerTail } from "./observability";
export { HttpGateway } from "./gateway";
export { FileSystem } from "./bindings/filesystem";
export { Git } from "./bindings/git";
export { LLM } from "./bindings/llm";
export { CodeSearch } from "./bindings/search";
export { Memory } from "./bindings/memory";

// ---------------------------------------------------------------------------
// Loader exports type — mirrors the shape of ctx.exports
// ---------------------------------------------------------------------------

type OrchestratorExports = {
  LogSession: {
    getByName(name: string): DurableObjectStub;
  };
  DynamicWorkerTail(opts: { props: { workerId: string; taskId: string } }): Fetcher;
  HttpGateway(opts: { props: GatewayProps }): Fetcher;
  FileSystem(opts: { props: FileSystemProps }): Fetcher;
  Git(opts: { props: GitProps }): Fetcher;
  LLM(opts: { props: LLMProps }): Fetcher;
  CodeSearch(opts: { props: SearchProps }): Fetcher;
  Memory(opts: { props: MemoryProps }): Fetcher;
};

interface GatewayProps {
  allowedDomains: string[];
  credentials: Record<string, string>;
  agentId: string;
  taskId: string;
}

interface FileSystemProps {
  owner: string;
  repo: string;
  branch: string;
  githubPat: string;
}

interface GitProps {
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  githubPat: string;
}

interface LLMProps {
  provider: "anthropic" | "openai";
  model: string;
  apiKey: string;
  taskId: string;
  agentType: string;
}

interface SearchProps {
  owner: string;
  repo: string;
  branch: string;
  githubPat: string;
}

interface MemoryProps {
  namespace: string;
  kvBinding: KVNamespace;
}

const ctxExports = exports as unknown as OrchestratorExports;

/**
 * Typed helper for TaskManager DO stubs. The Rpc generic type transformations
 * can produce `never` for complex return types — this function provides a
 * pragmatic typed interface over the raw stub.
 */
function getTaskDO(env: Env, taskId: string) {
  const doId = env.TASK_MANAGER.idFromName(taskId);
  const stub = env.TASK_MANAGER.get(doId) as unknown as {
    initialize(id: string, request: TaskRequest): Promise<TaskState>;
    getState(): Promise<TaskState>;
    setSubtasks(subtasks: SubTask[]): Promise<void>;
    transition(status: string): Promise<void>;
    addResult(result: AgentResult): Promise<void>;
    setReviewUrl(url: string): Promise<void>;
    setError(error: string): Promise<void>;
    isComplete(): Promise<boolean>;
    allSucceeded(): Promise<boolean>;
  };
  return stub;
}

function getCostDO(env: Env) {
  const doId = env.COST_TRACKER.idFromName("global");
  const stub = env.COST_TRACKER.get(doId) as unknown as {
    record(taskId: string, cost: CostBreakdown): Promise<void>;
    getUsage(since?: number): Promise<{
      tasks: Array<{ taskId: string; cost: CostBreakdown }>;
      aggregate: CostBreakdown;
    }>;
  };
  return stub;
}

// ---------------------------------------------------------------------------
// HTTP API router
// ---------------------------------------------------------------------------

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    try {
      // Health check
      if (url.pathname === "/" || url.pathname === "/health") {
        return Response.json({
          service: "agent-orchestrator",
          status: "healthy",
          version: "0.1.0",
        });
      }

      // Create tasks
      if (url.pathname === "/tasks" && request.method === "POST") {
        return handleCreateTasks(request, env, ctx);
      }

      // Get task status
      if (url.pathname.match(/^\/tasks\/[\w-]+$/) && request.method === "GET") {
        const taskId = url.pathname.split("/").pop()!;
        return handleGetTask(taskId, env);
      }

      // Human review decision
      if (
        url.pathname.match(/^\/tasks\/[\w-]+\/review$/) &&
        request.method === "POST"
      ) {
        const taskId = url.pathname.split("/")[2]!;
        return handleReviewDecision(taskId, request, env, ctx);
      }

      // WebSocket streaming for task logs
      if (
        url.pathname.match(/^\/tasks\/[\w-]+\/stream$/) &&
        request.headers.get("Upgrade") === "websocket"
      ) {
        const taskId = url.pathname.split("/")[2]!;
        return handleWebSocket(taskId, env);
      }

      // Usage / cost tracking
      if (url.pathname === "/usage" && request.method === "GET") {
        return handleUsage(url, env);
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    } catch (err) {
      console.error("Unhandled error:", err);
      return Response.json(
        {
          error: "internal_error",
          message: err instanceof Error ? err.message : "Unknown error",
        },
        { status: 500 }
      );
    }
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------------------
// POST /tasks — create one or more tasks
// ---------------------------------------------------------------------------

async function handleCreateTasks(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const body = (await request.json()) as CreateTaskRequest;
  if (!body.tasks?.length) {
    return Response.json(
      { error: "At least one task is required" },
      { status: 400 }
    );
  }

  const taskIds: string[] = [];

  for (const taskReq of body.tasks) {
    const taskId = crypto.randomUUID();
    const taskDO = getTaskDO(env, taskId);
    await taskDO.initialize(taskId, taskReq);

    taskIds.push(taskId);

    // Run task execution asynchronously
    ctx.waitUntil(executeTask(taskId, taskReq, env));
  }

  return Response.json({ taskIds } satisfies CreateTaskResponse, {
    status: 201,
  });
}

// ---------------------------------------------------------------------------
// GET /tasks/:id — get task status
// ---------------------------------------------------------------------------

async function handleGetTask(taskId: string, env: Env): Promise<Response> {
  const taskDO = getTaskDO(env, taskId);
  const state = await taskDO.getState();

  if (!state) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  return Response.json({ task: state });
}

// ---------------------------------------------------------------------------
// POST /tasks/:id/review — submit human review decision
// ---------------------------------------------------------------------------

async function handleReviewDecision(
  taskId: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const body = (await request.json()) as ReviewDecision;
  const taskDO = getTaskDO(env, taskId);
  const state = await taskDO.getState();

  if (!state || state.status !== "review") {
    return Response.json(
      { error: "Task is not in review state" },
      { status: 400 }
    );
  }

  if (body.decision === "approve") {
    await taskDO.transition("approved");
    ctx.waitUntil(finalizeTask(taskId, state, env));
    return Response.json({ status: "approved" });
  }

  if (body.decision === "reject") {
    await taskDO.transition("failed");
    await taskDO.setError(`Rejected by reviewer: ${body.feedback ?? "No reason given"}`);
    return Response.json({ status: "rejected" });
  }

  if (body.decision === "revise" && body.feedback) {
    await taskDO.transition("failed");
    const revisedRequest: TaskRequest = {
      ...state.request,
      description: `${state.request.description}\n\nRevision requested: ${body.feedback}`,
    };
    ctx.waitUntil(executeTask(taskId, revisedRequest, env));
    return Response.json({ status: "revision_requested" });
  }

  return Response.json({ error: "Invalid decision" }, { status: 400 });
}

// ---------------------------------------------------------------------------
// WebSocket /tasks/:id/stream — real-time log streaming
// ---------------------------------------------------------------------------

async function handleWebSocket(
  taskId: string,
  env: Env
): Promise<Response> {
  const logDoId = env.LOG_SESSION.idFromName(taskId);
  const logDO = env.LOG_SESSION.get(logDoId);
  return logDO.fetch(
    new Request("https://internal/ws", {
      headers: { Upgrade: "websocket" },
    })
  );
}

// ---------------------------------------------------------------------------
// GET /usage — cost tracking
// ---------------------------------------------------------------------------

async function handleUsage(url: URL, env: Env): Promise<Response> {
  const since = url.searchParams.get("since");
  const costDO = getCostDO(env);
  const usage = await costDO.getUsage(since ? parseInt(since, 10) : undefined);
  return Response.json(usage);
}

// ---------------------------------------------------------------------------
// Task execution engine
// ---------------------------------------------------------------------------

async function executeTask(
  taskId: string,
  taskReq: TaskRequest,
  env: Env
): Promise<void> {
  const taskDO = getTaskDO(env, taskId);

  try {
    const subtasks = decomposeTask(taskReq);
    await taskDO.setSubtasks(subtasks);
    await taskDO.transition("running");

    const completed = new Set<string>();
    const pending = [...subtasks];

    while (pending.length > 0) {
      const ready = pending.filter((st) =>
        st.dependencies.every((dep) => completed.has(dep))
      );

      if (ready.length === 0 && pending.length > 0) {
        throw new Error("Circular dependency detected in subtasks");
      }

      const results = await Promise.allSettled(
        ready.map((st) => runAgent(st, taskReq, taskId, env))
      );

      for (let i = 0; i < ready.length; i++) {
        const subtask = ready[i]!;
        const result = results[i]!;
        const idx = pending.indexOf(subtask);
        if (idx !== -1) pending.splice(idx, 1);

        if (result.status === "fulfilled") {
          await taskDO.addResult(result.value);
          completed.add(subtask.id);

          if (!result.value.success) {
            const retries = parseInt(env.MAX_AGENT_RETRIES, 10);
            const retried = await selfHealAgent(
              subtask,
              result.value,
              taskReq,
              taskId,
              env,
              retries
            );
            if (retried) {
              await taskDO.addResult(retried);
            }
          }
        } else {
          const failedResult: AgentResult = {
            subtaskId: subtask.id,
            agentType: subtask.agentType,
            success: false,
            output: { files: {}, summary: "" },
            error: result.reason?.message ?? "Unknown error",
            cost: zeroCost(),
            durationMs: 0,
          };
          await taskDO.addResult(failedResult);
          completed.add(subtask.id);
        }
      }
    }

    if (await taskDO.allSucceeded()) {
      await taskDO.transition("review");
    } else {
      await taskDO.transition("failed");
    }

    const finalState = await taskDO.getState();
    if (finalState.cost) {
      const costDO = getCostDO(env);
      await costDO.record(taskId, finalState.cost);
    }
  } catch (err) {
    console.error(`Task ${taskId} failed:`, err);
    await taskDO.setError(
      err instanceof Error ? err.message : "Unknown error"
    );
  }
}

// ---------------------------------------------------------------------------
// Task decomposition — break a request into subtasks
// ---------------------------------------------------------------------------

function decomposeTask(taskReq: TaskRequest): SubTask[] {
  const id = () => crypto.randomUUID().slice(0, 8);

  switch (taskReq.agentType) {
    case "codegen": {
      const codeId = id();
      const testId = id();
      const reviewId = id();
      return [
        {
          id: codeId,
          agentType: "codegen",
          description: taskReq.description,
          context: { files: taskReq.repo.files },
          dependencies: [],
        },
        {
          id: testId,
          agentType: "test",
          description: `Write tests for: ${taskReq.description}`,
          context: { files: taskReq.repo.files, dependsOn: codeId },
          dependencies: [codeId],
        },
        {
          id: reviewId,
          agentType: "review",
          description: `Review code generated for: ${taskReq.description}`,
          context: { files: taskReq.repo.files },
          dependencies: [codeId, testId],
        },
      ];
    }
    case "review": {
      return [
        {
          id: id(),
          agentType: "review",
          description: taskReq.description,
          context: { files: taskReq.repo.files },
          dependencies: [],
        },
      ];
    }
    case "test": {
      return [
        {
          id: id(),
          agentType: "test",
          description: taskReq.description,
          context: { files: taskReq.repo.files },
          dependencies: [],
        },
      ];
    }
    default: {
      return [
        {
          id: id(),
          agentType: taskReq.agentType,
          description: taskReq.description,
          context: { files: taskReq.repo.files },
          dependencies: [],
        },
      ];
    }
  }
}

// ---------------------------------------------------------------------------
// Agent runner — provisions a Dynamic Worker and executes the agent
// ---------------------------------------------------------------------------

async function runAgent(
  subtask: SubTask,
  taskReq: TaskRequest,
  taskId: string,
  env: Env
): Promise<AgentResult> {
  const startTime = Date.now();
  const agentId = `agent-${subtask.agentType}-${subtask.id}`;
  const { source: agentSource, entrypoint: agentEntrypoint } = getAgentSource(subtask.agentType);
  const config = taskReq.config ?? {};

  console.log(`[orchestrator] Launching ${agentId} for subtask ${subtask.id}`);

  const allowedDomains = env.ALLOWED_EGRESS_DOMAINS.split(",");
  const provider = (config.provider ?? env.DEFAULT_LLM_PROVIDER) as
    | "anthropic"
    | "openai";
  const apiKey =
    provider === "anthropic" ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;

  const { mainModule, modules } = await createWorker({
    files: {
      "src/agent.js": agentSource,
      "package.json": JSON.stringify({
        name: agentId,
        main: "src/agent.js",
      }),
    },
    bundle: true,
    minify: false,
  });

  const workerId = `${taskId}-${subtask.id}`;

  const worker = env.LOADER.get(workerId, async () => ({
    mainModule,
    modules: modules as Record<string, string>,
    compatibilityDate: "2026-03-24",
    compatibilityFlags: ["nodejs_compat"],

    env: {
      CONFIG: {
        taskId,
        description: subtask.description,
        files: taskReq.repo.files,
        targetFiles: Object.keys(taskReq.repo.files),
        context: subtask.context,
      },
    },

    globalOutbound: ctxExports.HttpGateway({
      props: {
        allowedDomains,
        credentials: {
          "api.github.com": env.GITHUB_PAT,
          "api.anthropic.com": env.ANTHROPIC_API_KEY,
          "api.openai.com": env.OPENAI_API_KEY,
        },
        agentId,
        taskId,
      },
    }),

    tails: [
      ctxExports.DynamicWorkerTail({
        props: { workerId, taskId },
      }),
    ],
  }));

  const entrypoint = worker.getEntrypoint(agentEntrypoint) as unknown as { run(): Promise<string> };

  const logSession = ctxExports.LogSession.getByName(workerId);
  const logWaiter = await (logSession as any).waitForLogs();

  let resultStr: string;
  try {
    resultStr = await entrypoint.run();
  } catch (err) {
    const logs = await (logWaiter as any).getLogs(2000);
    console.error(`[orchestrator] Agent ${agentId} threw:`, err, "Logs:", logs);
    throw err;
  }

  const logs = await (logWaiter as any).getLogs(1000);
  const durationMs = Date.now() - startTime;

  let parsed: Record<string, any>;
  try {
    parsed = JSON.parse(resultStr);
  } catch {
    parsed = { success: true, files: {}, summary: resultStr };
  }

  return {
    subtaskId: subtask.id,
    agentType: subtask.agentType,
    success: parsed.success ?? true,
    output: {
      files: parsed.files ?? {},
      summary: parsed.summary ?? "",
      diff: parsed.diff,
      prUrl: parsed.prUrl,
      testResults: parsed.testResults,
      reviewComments: parsed.reviewComments,
    },
    error: parsed.error,
    cost: parsed.cost ?? zeroCost(),
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Self-healing — retry failed agents with a debug agent
// ---------------------------------------------------------------------------

async function selfHealAgent(
  subtask: SubTask,
  failedResult: AgentResult,
  taskReq: TaskRequest,
  taskId: string,
  env: Env,
  maxRetries: number
): Promise<AgentResult | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(
      `[orchestrator] Self-heal attempt ${attempt}/${maxRetries} for ${subtask.id}`
    );

    const debugSubtask: SubTask = {
      id: `${subtask.id}-retry-${attempt}`,
      agentType: subtask.agentType,
      description: [
        `RETRY (attempt ${attempt}/${maxRetries}): ${subtask.description}`,
        `\nPrevious attempt failed with error: ${failedResult.error}`,
        "\nPlease fix the issues and try again.",
      ].join(""),
      context: {
        ...subtask.context,
        previousError: failedResult.error,
        attempt,
      },
      dependencies: [],
    };

    try {
      const result = await runAgent(debugSubtask, taskReq, taskId, env);
      if (result.success) return result;
      failedResult = result;
    } catch (err) {
      console.error(`Self-heal attempt ${attempt} failed:`, err);
    }

    const delay = 1000 * Math.pow(2, attempt - 1);
    await new Promise((r) => setTimeout(r, delay));
  }

  return null;
}

// ---------------------------------------------------------------------------
// Finalize — create PR after approval
// ---------------------------------------------------------------------------

async function finalizeTask(
  taskId: string,
  state: TaskState,
  env: Env
): Promise<void> {
  const taskDO = getTaskDO(env, taskId);

  try {
    const allFiles: Record<string, string> = {};
    for (const result of Object.values(state.results)) {
      if (result.output.files) {
        Object.assign(allFiles, result.output.files);
      }
    }

    if (Object.keys(allFiles).length > 0 && env.GITHUB_PAT) {
      const { owner, repo, branch, baseBranch } = state.request.repo;

      const resp = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.GITHUB_PAT}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "agent-orchestrator",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: `[Agent] ${state.request.description.slice(0, 72)}`,
            body: buildPrBody(state),
            head: branch,
            base: baseBranch,
          }),
        }
      );

      if (resp.ok) {
        const pr = (await resp.json()) as { html_url: string };
        await taskDO.setReviewUrl(pr.html_url);
      }
    }

    await taskDO.transition("completed");
  } catch (err) {
    console.error(`Finalize task ${taskId} failed:`, err);
    await taskDO.setError(
      err instanceof Error ? err.message : "Finalization failed"
    );
  }
}

function buildPrBody(state: TaskState): string {
  const lines = [
    "## Agent-Generated Pull Request",
    "",
    `**Task:** ${state.request.description}`,
    `**Agent:** ${state.request.agentType}`,
    "",
    "### Results",
    "",
  ];

  for (const [subtaskId, result] of Object.entries(state.results)) {
    lines.push(
      `- **${result.agentType}** (${subtaskId}): ${result.success ? "Success" : "Failed"}`
    );
    lines.push(`  ${result.output.summary}`);
    if (result.output.reviewComments?.length) {
      lines.push(`  Review comments: ${result.output.reviewComments.length}`);
    }
  }

  if (state.cost) {
    lines.push(
      "",
      "### Cost",
      `- Tokens: ${state.cost.totalTokens.toLocaleString()}`,
      `- Estimated: $${state.cost.estimatedCostUsd.toFixed(4)}`
    );
  }

  return lines.join("\n");
}

function zeroCost(): CostBreakdown {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    cpuTimeMs: 0,
    subrequests: 0,
  };
}
