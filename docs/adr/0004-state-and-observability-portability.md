# ADR-0004: State & Observability Portability

- Status: Proposed
- Date: 2026-07-07
- Deciders: Orchestrator maintainers
- Related: ADR-0001

## Context

Task state (`TaskManager`), cost aggregation (`CostTracker`), and log streaming (`LogSession` + `DynamicWorkerTail`) are implemented as Cloudflare Durable Objects and Tail Workers. Agent memory and credential scoping use Workers KV. None of these exist off-Cloudflare, but their *logic* (state machine, aggregation, log fan-out) is portable.

## Decision

Extract three ports:

- `StateStore` — persists task state and cost records. Adapters: Durable Objects (Cloudflare), in-memory (dev/tests), SQLite/Postgres/Redis (self-host). The state-machine + aggregation logic moves into plain classes that depend only on `StateStore`.
- `KeyValueStore` — agent memory + credential scoping. Adapters: KV (Cloudflare), in-memory, Redis.
- `LogSink` — receives agent logs and fans them out to HTTP/WebSocket subscribers. Cloudflare adapter keeps Tail Worker -> DO -> WebSocket; local adapter uses an in-process `EventEmitter` + WebSocket server.

Selection is config-driven (`STATE_STORE`, `KV_STORE`). Defaults: Cloudflare adapters when running on Workers; in-memory/SQLite when running locally.

## Consequences

Positive:
- State and observability no longer require Cloudflare.
- Pure logic (transitions, cost math, log fan-out) becomes unit-testable without runtime fakes.

Negative / trade-offs:
- In-memory store is non-durable (fine for dev; SQLite/Postgres for real self-host).
- Multiple storage adapters to test; mitigated by a shared conformance test suite run against every adapter.

Neutral:
- Existing DO tests continue to validate the Cloudflare adapter.
