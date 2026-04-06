# Architecture

This document describes the system architecture of the Agent Orchestrator platform — how requests flow through the system, how components interact, and how Dynamic Workers are provisioned.

---

## High-Level Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                     CLIENT (HTTP / WebSocket)                    │
│                                                                  │
│  POST /tasks ─── create tasks                                    │
│  GET  /tasks/:id ─── poll status                                 │
│  POST /tasks/:id/review ─── approve / reject / revise            │
│  WS   /tasks/:id/stream ─── real-time log stream                 │
│  GET  /usage ─── cost breakdown                                  │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│               ORCHESTRATOR WORKER  (src/index.ts)                │
│                                                                  │
│  1. Validates request                                            │
│  2. Creates TaskManager Durable Object                           │
│  3. Decomposes task into subtasks with dependency graph           │
│  4. Bundles agent source via @cloudflare/worker-bundler           │
│  5. Provisions Dynamic Worker per subtask                        │
│  6. Collects results, manages retries (self-heal)                │
│  7. On approval, creates GitHub PR                               │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ TaskManager   │  │ CostTracker  │  │  LogSession   │          │
│  │  (Durable Obj)│  │ (Durable Obj)│  │ (Durable Obj) │          │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└──────────┬───────────────────────────────────────────────────────┘
           │
           │  env.LOADER.get(workerId, callback)
           │
           ▼
┌──────────────────────────────────────────────────────────────────┐
│              DYNAMIC WORKER  (sandboxed V8 isolate)              │
│                                                                  │
│  Agent code (CodeGen / Test / Review) compiled and bundled       │
│  at runtime, then loaded into an isolated Worker.                │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  env.FS      → FileSystem RPC  (GitHub Contents API)    │     │
│  │  env.GIT     → Git RPC         (GitHub Git Data API)    │     │
│  │  env.LLM     → LLM RPC         (Anthropic / OpenAI)    │     │
│  │  env.SEARCH  → CodeSearch RPC   (GitHub Search API)     │     │
│  │  env.MEMORY  → Memory RPC       (Workers KV)           │     │
│  │  env.CONFIG  → Task context     (plain object)          │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                  │
│  globalOutbound → HttpGateway  (egress control)                  │
│  tails          → DynamicWorkerTail  (observability)             │
└──────────────────────────────────────────────────────────────────┘
```

---

## Component Map

| Component | Source File | Type | Responsibility |
|---|---|---|---|
| Orchestrator | `src/index.ts` | Worker (main entry) | HTTP API routing, task decomposition, Dynamic Worker provisioning, result aggregation |
| TaskManager | `src/state.ts` | Durable Object | Task lifecycle state machine with persistent storage |
| CostTracker | `src/state.ts` | Durable Object | Aggregate token/CPU cost data across all tasks |
| LogSession | `src/observability.ts` | Durable Object | Bridges Tail Worker logs to HTTP callers and WebSocket clients |
| DynamicWorkerTail | `src/observability.ts` | WorkerEntrypoint (Tail) | Captures `console.*` output and exceptions from agent Workers |
| HttpGateway | `src/gateway.ts` | WorkerEntrypoint | Egress firewall — domain allowlist + credential injection |
| FileSystem | `src/bindings/filesystem.ts` | WorkerEntrypoint (RPC) | Scoped file read/write/list/delete via GitHub Contents API |
| Git | `src/bindings/git.ts` | WorkerEntrypoint (RPC) | Branch, commit, diff, PR creation via GitHub Git Data API |
| LLM | `src/bindings/llm.ts` | WorkerEntrypoint (RPC) | AI model calls with retry logic and cost tracking |
| CodeSearch | `src/bindings/search.ts` | WorkerEntrypoint (RPC) | Code search, file discovery, symbol extraction |
| Memory | `src/bindings/memory.ts` | WorkerEntrypoint (RPC) | Persistent KV-backed agent memory, namespaced per project |
| CodeGenAgent | `src/agents/codegen.ts` | Agent source (bundled at runtime) | Generates code from natural language spec |
| TestAgent | `src/agents/test.ts` | Agent source (bundled at runtime) | Writes unit/integration tests |
| ReviewAgent | `src/agents/review.ts` | Agent source (bundled at runtime) | Code review with structured severity-rated comments |

---

## Task Lifecycle State Machine

Each task is backed by a `TaskManager` Durable Object that enforces valid transitions:

```
                          ┌────────────┐
                          │  pending    │
                          └─────┬──────┘
                                │  setSubtasks()
                                ▼
                          ┌────────────┐
                          │  assigned   │
                          └─────┬──────┘
                                │  transition("running")
                                ▼
                          ┌────────────┐
                   ┌──────│  running    │──────┐
                   │      └─────┬──────┘      │
                   │            │              │
                   │ (all pass) │              │ (any fail)
                   ▼            │              ▼
            ┌────────────┐     │       ┌────────────┐
            │   review    │     │       │   failed    │──→ (retry → pending)
            └─────┬──────┘     │       └────────────┘
                  │            │
        ┌─────────┼────────┐   │
        ▼         ▼        ▼   │
   (approve) (reject)  (revise)│
        │         │        │   │
        ▼         ▼        ▼   │
  ┌──────────┐ ┌──────┐ re-run │
  │ approved  │ │failed│       │
  └────┬─────┘ └──────┘       │
       │                       │
       ▼                       │
  ┌────────────┐               │
  │ completed   │◄──────────────┘
  └────────────┘
```

Valid transitions are enforced in `src/state.ts`:

| From | Allowed Targets |
|---|---|
| `pending` | `assigned`, `cancelled`, `failed` |
| `assigned` | `running`, `cancelled`, `failed` |
| `running` | `review`, `completed`, `failed`, `cancelled` |
| `review` | `approved`, `failed`, `cancelled` |
| `approved` | `completed`, `failed` |
| `completed` | *(terminal)* |
| `failed` | `pending` (enables retries) |
| `cancelled` | *(terminal)* |

---

## Task Decomposition

When a task arrives, the orchestrator breaks it into subtasks with dependency edges. The current decomposition strategy for a `codegen` task:

1. **CodeGen subtask** — generates the requested code (no dependencies)
2. **Test subtask** — writes tests for the generated code (depends on step 1)
3. **Review subtask** — reviews both code and tests (depends on steps 1 and 2)

Subtasks with satisfied dependencies run in parallel via `Promise.allSettled()`. The execution engine processes waves of ready subtasks until all complete or fail.

---

## Dynamic Worker Provisioning

For each subtask, the orchestrator:

1. Calls `getAgentSource(agentType)` to retrieve the JavaScript source string and entrypoint name.
2. Calls `createWorker()` from `@cloudflare/worker-bundler` to compile and bundle the source.
3. Calls `env.LOADER.get(workerId, callback)` with:
   - `mainModule` / `modules` — the bundled agent code
   - `env` — `CONFIG` object with task description, files, and context
   - `globalOutbound` — `HttpGateway` stub for egress control
   - `tails` — `DynamicWorkerTail` stub for log capture
4. Calls `worker.getEntrypoint(name).run()` to execute the agent.
5. Awaits real-time logs from the `LogSession` Durable Object.

Workers are cached by ID (a combination of `taskId` and `subtaskId`), so retries of the same subtask with different code get fresh isolates.

---

## Self-Healing Flow

When an agent returns `success: false`, the orchestrator enters a self-heal loop:

1. Creates a new subtask with the original description plus the error context.
2. Re-runs the agent with the augmented prompt.
3. If the retry succeeds, its result replaces the original.
4. Retries use exponential backoff: 1s, 2s, 4s between attempts.
5. Maximum retries are configured via `MAX_AGENT_RETRIES` (default: 3).

---

## Observability Pipeline

```
Agent Dynamic Worker
  │ console.log() / console.error() / throw
  ▼
DynamicWorkerTail (Tail Worker)
  │ Receives TraceItem[] after agent completes
  │ Normalizes logs + exceptions into LogEntry[]
  │ Writes to Workers Logs (console.log from the Tail Worker itself)
  ▼
LogSession (Durable Object)
  │ Stores all logs in memory
  │ Notifies waiting LogWaiter instances
  │ Pushes to connected WebSocket clients
  ▼
Client
  ├── HTTP poll: GET /tasks/:id (includes logs in task state)
  └── WebSocket: WS /tasks/:id/stream (real-time push)
```

---

## Cost Tracking

Every agent result includes a `CostBreakdown` recording:

- `inputTokens` / `outputTokens` — LLM token counts
- `estimatedCostUsd` — dollar estimate using per-model pricing
- `cpuTimeMs` — wall-clock execution time
- `subrequests` — count of outbound HTTP calls

The `CostTracker` Durable Object persists these per-task and serves aggregate queries via `GET /usage?since=<timestamp>`.
