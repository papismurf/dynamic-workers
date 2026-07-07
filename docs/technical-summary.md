# Technical Summary — Platform-Agnostic Orchestrator + Crypto-Payments Example

This document summarizes the two-task effort to (1) determine whether the
Cloudflare-only Dynamic Workers orchestrator can become platform-agnostic and
(2) implement that conversion plus a new, modular crypto-payments example.

## Scope & branches

| Task | Branch | Deliverable |
| ---- | ------ | ----------- |
| 1 — Feasibility deep-dive | `feat/platform-agnostic-analysis` | `docs/platform-agnostic-feasibility.md` + ADRs 0001–0004 |
| 2 — Implementation + example | `feat/platform-agnostic-impl` | Provider/runtime/state abstractions, local Node runtime, `examples/crypto-payments` |

Both tasks used a plan-first workflow with an independent **review-agent gate**
on each commit, per the [Principal Software Engineer skill](../.cursor/skills/principal-software-engineer/SKILL.md).

## Task 1 — Is it feasible? Yes.

The orchestrator's *logic* (task decomposition, dependency scheduling, bounded
concurrency, self-heal, review flow, cost aggregation) is platform-neutral. The
coupling to Cloudflare is concentrated in a few well-defined seams:

- **Compute:** Worker Loader dynamically provisions agent workers.
- **State:** Durable Objects (`TaskManager`, `CostTracker`, `LogSession`).
- **KV / config:** `KVNamespace` bindings.
- **Egress:** the `HttpGateway` binding for allowlisted outbound calls.

Because these are edges rather than pervasive dependencies, the system can be
made portable with a **ports-and-adapters** design. See the feasibility doc and
ADRs for the full analysis:

- ADR 0001 — Runtime/compute abstraction (`AgentRuntime`)
- ADR 0002 — LLM provider abstraction (`LlmProvider`)
- ADR 0003 — Payment provider abstraction (used by the example)
- ADR 0004 — State & observability portability (`StateStore`, `KeyValueStore`, `LogSink`)

## Task 2 — What was built

### Ports (clean seams)

- `src/core/ports.ts` — `StateStore`, `AgentRuntime`.
- `src/providers/llm/types.ts` — `LlmProvider` (chat over any backend).

### Runtime-neutral orchestration core (`src/core/`)

Pure logic extracted from the Cloudflare handler so it can run anywhere:

- `state-machine.ts` — transition table + cost aggregation (pure).
- `decompose.ts` — task → subtasks with dependencies (pure).
- `semaphore.ts` — counting semaphore bounding concurrent agents (rate-limit safe).
- `orchestrator.ts` — decomposition, concurrent scheduling, failed-dependency
  skipping, self-heal (cost-accurate across retries), and review flow.
- `memory-state-store.ts` — in-memory `StateStore` for local/testing.

### LLM provider layer (`src/providers/llm/`)

- `anthropic.ts`, `openai-compatible.ts` (OpenAI, DeepSeek, Ollama, self-hosted),
  selected by `registry.ts`.
- `pricing.ts` (longest-prefix model pricing) and `retry.ts` (backoff + jitter).
- Providers accept an injectable `fetchImpl`, letting the runtime enforce egress
  policy on the actual network call.
- `src/bindings/llm.ts` was refactored to delegate to this layer (backward
  compatible on Cloudflare).

### Local, no-Cloudflare runtime (`src/runtime/`, `src/local/`)

- `runtime/egress.ts` — `EgressPolicy`: domain allowlist + credential injection,
  exposed as a `guardedFetch`.
- `runtime/local.ts` — `LocalRuntime` implementing `AgentRuntime` with an
  in-memory filesystem and egress-guarded LLM calls.
- `local/server.ts` + `local/main.ts` — Node HTTP server exposing the REST API
  and SSE log streaming; run with `npm run dev:local` / `npm run start:local`.

### New example — `examples/crypto-payments/`

A self-contained TypeScript/Node payment service applying the same pattern: one
`PaymentProvider` port with **Stripe, PayPal, Coinbase Commerce, and Mock**
adapters, swappable purely via the `PAYMENT_PROVIDER` env var.

Highlights:
- Webhook signatures verified per provider **before** trusting event data
  (timing-safe HMAC-SHA256; Stripe replay tolerance; PayPal server-side verify).
- Currency-aware money in **integer minor units** (`money.ts`) — correct for
  zero-decimal fiat (JPY) and crypto precisions, not a hardcoded `/100`.
- Error paths never leak upstream provider responses to callers.
- 15 tests (Node test runner via `tsx`) covering provider selection, charge
  mapping, money conversion, and valid/tampered/replayed webhooks.

## Backward compatibility

The Cloudflare deployment is untouched at the edges: existing bindings, routes,
Durable Objects, and env var names are preserved. New abstractions were added
additively; `bindings/llm.ts` delegates to the new provider layer without
changing its public contract.

## Quality gates

- **Review-agent gate:** every commit was reviewed by an independent agent that
  re-runs checks against the design/architecture checklist; blocking findings
  were resolved before commit. The crypto-payments example went through a
  REQUEST-CHANGES → fixes → APPROVE cycle (money conversion, PayPal capture
  semantics, error-leak hardening).
- **CI:** `.github/workflows/crypto-payments-ci.yml` runs typecheck + tests +
  `npm audit` for the example on every relevant push/PR.

## Known issues & follow-ups (pre-existing, out of scope)

- **Root `npm run typecheck` is red:** the root `tsconfig.json` includes
  `*.test.ts` but lacks Jest types, so test files report `Cannot find name 'it'`
  etc. Tests themselves compile via ts-jest's `tsconfig.test.json`. *Follow-up:*
  exclude tests from the root `tsc` config or add a `typecheck:test` script that
  points at `tsconfig.test.json`.
- **A few root unit tests fail in the local sandbox** due to missing
  `WebSocketPair` shims and fake-timer flakiness under Node 24 — environmental,
  not caused by this work.
- **`examples/crypto-payments` `POST /charges`** returns provider errors as a
  generic 502 and logs details; provider adapters could add richer typed error
  categories in future.

## How to run

```bash
# Orchestrator, locally, no Cloudflare account:
npm install
npm run dev:local

# Crypto-payments example:
cd examples/crypto-payments
npm install && cp .env.example .env
npm start        # defaults to the mock provider
npm test         # 15 tests
```
