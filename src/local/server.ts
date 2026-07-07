/**
 * Local HTTP server — the no-Cloudflare entry point. Exposes the same REST
 * surface as the Cloudflare orchestrator (src/index.ts) but backed by the
 * runtime-neutral core: Orchestrator + LocalRuntime + InMemoryStateStore.
 *
 * Uses only Node built-ins (no web framework). Run with `npm run dev:local`.
 */
import http from "node:http";
import type { CreateTaskRequest, ReviewDecision } from "../types.js";
import { Orchestrator } from "../core/orchestrator.js";
import { InMemoryStateStore } from "../core/memory-state-store.js";
import { LocalRuntime } from "../runtime/local.js";
import { LogHub } from "./log-hub.js";
import { loadConfig, type LocalConfig } from "./config.js";

export interface AppDeps {
  orchestrator: Orchestrator;
  logHub: LogHub;
}

export interface RestResult {
  status: number;
  json: unknown;
}

/** Build the orchestration stack for the local runtime from config. */
export function createApp(config: LocalConfig): AppDeps {
  const store = new InMemoryStateStore();
  const runtime = new LocalRuntime({ llm: config.llm });
  const logHub = new LogHub();
  const orchestrator = new Orchestrator(store, runtime, {
    maxParallelAgents: config.maxParallelAgents,
    maxAgentRetries: config.maxAgentRetries,
    onLog: (taskId, entry) => logHub.publish(taskId, entry),
  });
  return { orchestrator, logHub };
}

const TASK_ID_RE = /^\/tasks\/([\w-]+)$/;
const REVIEW_RE = /^\/tasks\/([\w-]+)\/review$/;

/**
 * Handle the JSON REST routes. Returns `null` for the SSE stream path (handled
 * by the Node server) or unknown routes so the caller can 404.
 */
export async function handleRest(
  deps: AppDeps,
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
  body: unknown
): Promise<RestResult | null> {
  const { orchestrator } = deps;

  if ((pathname === "/" || pathname === "/health") && method === "GET") {
    return { status: 200, json: { service: "agent-orchestrator", status: "healthy", runtime: "local" } };
  }

  if (pathname === "/tasks" && method === "POST") {
    const req = body as CreateTaskRequest;
    if (!req?.tasks?.length) {
      return { status: 400, json: { error: "At least one task is required" } };
    }
    const taskIds: string[] = [];
    for (const task of req.tasks) {
      taskIds.push(await orchestrator.createTask(task));
    }
    return { status: 201, json: { taskIds } };
  }

  const taskMatch = pathname.match(TASK_ID_RE);
  if (taskMatch && method === "GET") {
    const state = await orchestrator.getTask(taskMatch[1]!);
    if (!state) return { status: 404, json: { error: "Task not found" } };
    return { status: 200, json: { task: state } };
  }

  const reviewMatch = pathname.match(REVIEW_RE);
  if (reviewMatch && method === "POST") {
    const result = await orchestrator.review(reviewMatch[1]!, body as ReviewDecision);
    if ("error" in result) return { status: 400, json: result };
    return { status: 200, json: result };
  }

  if (pathname === "/usage" && method === "GET") {
    const since = searchParams.get("since");
    const usage = await orchestrator.getUsage(since ? Number(since) : undefined);
    return { status: 200, json: usage };
  }

  return null;
}

const STREAM_RE = /^\/tasks\/([\w-]+)\/stream$/;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createNodeServer(deps: AppDeps): http.Server {
  return http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = req.method ?? "GET";

      if (method === "OPTIONS") {
        res.writeHead(204, CORS);
        res.end();
        return;
      }

      // SSE log stream.
      const streamMatch = url.pathname.match(STREAM_RE);
      if (streamMatch && method === "GET") {
        const taskId = streamMatch[1]!;
        res.writeHead(200, {
          ...CORS,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        for (const entry of deps.logHub.history(taskId)) {
          res.write(`data: ${JSON.stringify(entry)}\n\n`);
        }
        const unsubscribe = deps.logHub.subscribe(taskId, (entry) => {
          res.write(`data: ${JSON.stringify(entry)}\n\n`);
        });
        req.on("close", unsubscribe);
        return;
      }

      try {
        const body = method === "POST" ? await readBody(req) : undefined;
        const result = await handleRest(deps, method, url.pathname, url.searchParams, body);
        if (!result) {
          res.writeHead(404, { ...CORS, "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }
        res.writeHead(result.status, { ...CORS, "Content-Type": "application/json" });
        res.end(JSON.stringify(result.json));
      } catch (err) {
        res.writeHead(500, { ...CORS, "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "internal_error",
            message: err instanceof Error ? err.message : "Unknown error",
          })
        );
      }
    })();
  });
}

/** Entry point used by `npm run dev:local` (invoked from src/local/main.ts). */
export function main(): void {
  const config = loadConfig();
  const deps = createApp(config);
  const server = createNodeServer(deps);
  server.listen(config.port, config.host, () => {
    console.log(
      `[local] agent-orchestrator listening on http://${config.host}:${config.port} ` +
        `(provider=${config.llm.provider}, model=${config.llm.model}, maxParallel=${config.maxParallelAgents})`
    );
  });
}
