# Research Brief: Cloudflare Dynamic Workers

This document summarizes the deep-research findings on Cloudflare's Dynamic Workers platform that informed the design of the Agent Orchestrator.

---

## 1. Core Primitives

Dynamic Workers allow a parent Cloudflare Worker to create and execute child Workers at runtime. The child's source code is provided as strings — no pre-deployment required.

### Worker Loader Binding

Configured in `wrangler.jsonc`:

```jsonc
{ "worker_loaders": [{ "binding": "LOADER" }] }
```

This exposes `env.LOADER` with two methods:

### `env.LOADER.load(code: WorkerCode): WorkerStub`

- Creates a **fresh** Dynamic Worker on every call.
- Best for one-off executions (e.g., AI-generated throwaway code).
- No caching — every invocation cold-starts.

### `env.LOADER.get(id: string, callback: () => Promise<WorkerCode>): WorkerStub`

- Caches Workers **by ID**. If the same ID is requested again, the existing warm isolate may be reused.
- The callback only fires when the system needs fresh code (cold start or eviction).
- The ID should change whenever the code changes (e.g., use a content hash or version string).
- Returns a `WorkerStub` synchronously — requests queue until the worker is ready.
- **No guarantee** of isolate reuse between requests, even with the same stub.

### WorkerCode Object

```typescript
interface WorkerCode {
  compatibilityDate: string;           // e.g., "2026-03-24"
  compatibilityFlags?: string[];       // e.g., ["nodejs_compat"]
  mainModule: string;                  // Entry module name
  modules: Record<string, string>;     // Module name → source code
  env?: object;                        // Custom bindings (serializable + RPC stubs)
  globalOutbound?: ServiceStub | null; // Egress control
  tails?: ServiceStub[];               // Observability (Tail Workers)
}
```

Module values can be plain strings (with `.js` or `.py` extension) or typed objects: `{js: string}`, `{cjs: string}`, `{py: string}`, `{text: string}`, `{data: ArrayBuffer}`, `{json: object}`.

### Cold vs. Warm Starts

- `get()` enables warm starts by caching isolates by ID.
- Warm start: isolate already in memory, callback not invoked.
- Cold start: new V8 isolate, callback invoked to get code.
- Dynamic Workers start in **milliseconds** (100x faster than containers per Cloudflare benchmarks).
- Python Workers have significantly slower cold starts than JavaScript — JS is strongly recommended.

---

## 2. Capability-Based Bindings (Cap'n Web)

Dynamic Workers use **Workers RPC** (a.k.a. Cap'n Web, built on Cap'n Proto) for inter-Worker communication. This implements a **capability-based security model**.

### Key Concepts

- **WorkerEntrypoint classes** define RPC interfaces. Methods are callable across security boundaries.
- **`ctx.exports`** creates loopback service stubs from entrypoint classes exported by the parent Worker.
- **`ctx.props`** specializes a binding for a specific invocation (e.g., per-tenant, per-agent).
- Objects are passed **by reference** as RPC stubs. If a Dynamic Worker hasn't been given a stub, it cannot call that object.
- This is the same model used by Android (Binder), Chrome (Mojo), and Cloudflare internally.

### Pattern: Custom Bindings

```typescript
// Parent defines an RPC interface
export class FileSystem extends WorkerEntrypoint<Env, Props> {
  async read(path: string): Promise<string> { /* ... */ }
}

// Parent creates a specialized stub and passes it to the child
const worker = env.LOADER.get(id, () => ({
  env: {
    FS: ctx.exports.FileSystem({ props: { owner, repo, branch, githubPat } }),
  },
  // ...
}));
```

The Dynamic Worker calls `env.FS.read("src/index.ts")` — it never sees the `githubPat`.

### Design Insight

Per Cloudflare's documentation: *"Give your agent TypeScript types describing the API, complete with comments documenting each declaration. Modern LLMs understand TypeScript well, making it by far the most concise way to describe a JavaScript API."*

This informed our decision to define typed interfaces (`FileSystemAPI`, `GitAPI`, `LLMAPI`, `CodeSearchAPI`, `MemoryAPI`) in `src/types.ts` that are given to agent LLMs as tool documentation.

---

## 3. Observability

### Tail Workers

A Tail Worker is a `WorkerEntrypoint` subclass with a `tail(events: TraceItem[])` method. It receives:

- `event.logs` — all `console.log()` / `console.error()` calls from the Dynamic Worker
- `event.exceptions` — all uncaught exceptions
- `event.event` — request metadata (URL, method, status, outcome)

Tail Workers run **asynchronously after** the Dynamic Worker has already sent its response — they add **zero latency**.

### Log Streaming via Durable Objects

The challenge: Tail Workers and the parent's `fetch()` handler run in separate contexts. The solution is a `LogSession` Durable Object that both can address:

1. Parent creates a `LogSession` DO before running the agent.
2. Agent runs, produces logs.
3. After the agent finishes, the Tail Worker writes logs to the same DO.
4. Parent reads logs from the DO and returns them (or streams via WebSocket).

### Workers Logs Integration

By enabling `observability.enabled = true` in `wrangler.jsonc`, the Tail Worker's own `console.log()` calls are captured by Workers Logs. This gives permanent, searchable storage of all agent output.

---

## 4. Egress Control

The `globalOutbound` field in `WorkerCode` controls all outbound network access from the Dynamic Worker.

| Value | Behavior |
|---|---|
| *(not set)* | Inherits parent's network access (full internet) |
| `null` | Blocks all `fetch()` and `connect()` — throws exceptions |
| `ServiceStub` | Routes all outbound through the specified WorkerEntrypoint |

### Pattern: Intercepting Gateway

```typescript
export class HttpGateway extends WorkerEntrypoint {
  async fetch(request) {
    // Every outbound fetch() from the Dynamic Worker arrives here.
    // Inspect, modify, block, or forward the request.
    return fetch(request);
  }
}
```

### Use Cases in This System

- **Domain allowlist**: Only `api.github.com`, `api.anthropic.com`, `api.openai.com`, `registry.npmjs.org` are permitted.
- **Credential injection**: GitHub PATs and API keys are attached by the gateway, never visible to agents.
- **Audit logging**: Every outbound request is logged with agent ID and task ID.

---

## 5. Runtime Bundling (@cloudflare/worker-bundler)

The `@cloudflare/worker-bundler` package (v0.0.4, experimental) handles TypeScript compilation and npm dependency resolution at runtime inside a Worker.

### API

```typescript
import { createWorker } from "@cloudflare/worker-bundler";

const { mainModule, modules, wranglerConfig, warnings } = await createWorker({
  files: {
    "src/index.ts": "/* TypeScript source */",
    "package.json": JSON.stringify({ dependencies: { hono: "^4.0.0" } }),
  },
  bundle: true,
  minify: false,
});
```

- `files` — a `Record<string, string>` of virtual file paths to source content.
- `bundle` — whether to resolve and inline npm dependencies.
- `minify` — whether to minify the output.
- Returns `mainModule` (entry module name) and `modules` (compiled output) ready for `load()` / `get()`.

### Constraints

- Still experimental — not recommended for production by Cloudflare.
- Adds build time (50-500ms depending on complexity) before the Dynamic Worker can execute.
- Only bundles what's available on npm; private registries not supported.

---

## 6. Workers for Platforms / Dynamic Dispatch

For multi-tenant routing at scale, Cloudflare offers **dispatch namespaces** via Workers for Platforms:

- `env.DISPATCHER.get(workerName)` — routes to a named Worker in a dispatch namespace.
- Supports KV-based routing, subdomain-based routing, and path-based routing.
- Custom CPU/subrequest limits per Worker via `{ limits: { cpuMs, subRequests } }`.

This is complementary to Dynamic Workers and could be used for routing tasks to region-specific orchestrators in a future evolution.

---

## 7. Constraints and Limitations

| Constraint | Detail |
|---|---|
| Language support | JS (ESM, CJS) and Python; TypeScript must be pre-compiled |
| Cold start | JS: milliseconds; Python: significantly slower |
| Isolate reuse | Not guaranteed — `get()` caches by ID but may restart |
| CPU limits | Standard Workers limits apply (default: 30s for Unbound) |
| Memory | Standard Workers memory limits (128 MB per isolate) |
| Subrequests | 1000 per request (Workers Paid plan) |
| Bundler maturity | `@cloudflare/worker-bundler` is experimental |
| KV consistency | Eventually consistent reads; strong consistency within a colo |
| DO storage | 128 KB per key, 10 GB total per namespace |
| WebSocket | Limited to 30 seconds idle without pings |

---

## 8. Sources

- [Dynamic Workers Overview](https://developers.cloudflare.com/dynamic-workers/)
- [Dynamic Workers API Reference](https://developers.cloudflare.com/dynamic-workers/api-reference/)
- [Dynamic Workers Getting Started](https://developers.cloudflare.com/dynamic-workers/getting-started/)
- [Bindings](https://developers.cloudflare.com/dynamic-workers/usage/bindings/)
- [Observability](https://developers.cloudflare.com/dynamic-workers/usage/observability/)
- [Egress Control](https://developers.cloudflare.com/dynamic-workers/usage/egress-control/)
- [Dynamic Workers Playground (GitHub)](https://github.com/cloudflare/agents/tree/main/examples/dynamic-workers-playground)
- [Dynamic Dispatch Worker](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/dynamic-dispatch/)
- [Cloudflare Blog: Dynamic Workers](https://blog.cloudflare.com/dynamic-workers/)
