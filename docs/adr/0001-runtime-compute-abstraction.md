# ADR-0001: Runtime / Compute Abstraction (decouple from Cloudflare Worker Loader)

- Status: Proposed
- Date: 2026-07-07
- Deciders: Orchestrator maintainers
- Related: ADR-0002, ADR-0004

## Context

The orchestrator currently provisions each agent via the Cloudflare **Worker Loader** (`env.LOADER.get`), which spins up an isolated V8 isolate, injects capability-scoped RPC bindings, applies a `globalOutbound` egress firewall, and captures logs via a Tail Worker. This requires a Cloudflare account and ties the entire execution model to `cloudflare:workers` and `@cloudflare/worker-bundler`.

We want users to run the orchestrator on any host and against any concurrent-capable LLM backend, without a Cloudflare account, while not regressing the existing Cloudflare deployment.

## Decision

Introduce an `AgentRuntime` port that encapsulates *how and where an agent executes*, including its isolation boundary and egress policy:

```ts
interface AgentRuntime {
  runAgent(spec: AgentRunSpec): Promise<AgentRunResult>;
}
```

Provide adapters:

- `CloudflareWorkerLoaderRuntime` — wraps the existing Worker Loader path unchanged (strongest isolation; requires Cloudflare).
- `LocalRuntime` — executes agent logic in-process (or in a `worker_thread`/subprocess for stronger isolation) with plain capability binding objects and an injected `fetch` wrapper that enforces the same domain allowlist + credential injection as the current `HttpGateway`. No Cloudflare account required.
- `ContainerRuntime` (optional/future) — generic container/serverless target for OS-level isolation.

Agent logic is refactored to a single `run(ctx)` definition against typed bindings (`FileSystemAPI`, `GitAPI`, `LLMAPI`, ...). The Cloudflare runtime ships it as bundled source into an isolate; other runtimes invoke it directly, removing the `@cloudflare/worker-bundler` dependency off-platform. Runtime selection is config-driven via a `RUNTIME` env var.

## Consequences

Positive:
- Removes the hard Cloudflare account requirement for the common case.
- Orchestration core (scheduling, self-heal, review, cost) becomes runtime-neutral.
- Enables local dev, self-hosting, and CI without Cloudflare.

Negative / trade-offs:
- Off-Cloudflare isolation is weaker unless a subprocess/worker_thread is used; documented and defaulted conservatively. The egress allowlist remains mandatory in every runtime.
- Two+ execution paths to maintain and test.

Neutral:
- The `HttpGateway` allowlist/credential-injection logic is reused (extracted to a shared policy module) rather than rewritten.
