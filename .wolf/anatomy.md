# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-07-08T08:48:37.594Z
> Files: 204 tracked | Anatomy hits: 0 | Misses: 0

## ../../../../../../../../home/brown/.claude/plans/

- `shiny-knitting-stream.md` — Plan: Docker Compose full-stack restart (orchestrator + task-ui) (~650 tok)

## ./

- `.dev.vars` — Copy to .dev.vars for local development (read by `wrangler dev`) and/or (~318 tok)
- `.dockerignore` — Docker ignore rules (~41 tok)
- `.gitignore` — Git ignore rules (~19 tok)
- `CLAUDE.md` — OpenWolf (~57 tok)
- `docker-compose.dev.yml` — Development override — runs `wrangler dev` with hot reload. (~498 tok)
- `docker-compose.prod.yml` — Production override — runs `wrangler deploy` against Cloudflare. (~411 tok)
- `docker-compose.yml` — Docker Compose services (~231 tok)
- `Dockerfile` — Docker container definition (~502 tok)
- `jest.config.ts` — Jest configuration for the Agent Orchestrator test suite. (~929 tok)
- `LICENSE` — Project license (~4296 tok)
- `package-lock.json` — npm lock file (~55962 tok)
- `package.json` — Node.js package manifest (~450 tok)
- `playwright.config.ts` — Playwright test configuration (~686 tok)
- `README.md` — Project documentation (~2817 tok)
- `tsconfig.json` — TypeScript configuration (~142 tok)
- `tsconfig.test.json` — /*.ts", (~140 tok)
- `wrangler.jsonc` (~392 tok)

## .claude/

- `settings.json` (~441 tok)
- `settings.local.json` (~136 tok)

## .claude/rules/

- `openwolf.md` (~313 tok)

## .github/workflows/

- `ci.yml` — CI: CI (~346 tok)
- `claude-code-review.yml` — /*.ts" (~422 tok)
- `claude.yml` — CI: Claude Code (~554 tok)
- `crypto-payments-ci.yml` — CI: crypto-payments example CI (~327 tok)

## .wrangler/state/v3/cache/miniflare-CacheObject/

- `metadata.sqlite-shm` (~8738 tok)
- `metadata.sqlite-wal` (~2205 tok)

## .wrangler/state/v3/do/agent-orchestrator-CostTracker/

- `metadata.sqlite-shm` (~8739 tok)
- `metadata.sqlite-wal` (~2206 tok)

## .wrangler/state/v3/do/agent-orchestrator-LogSession/

- `metadata.sqlite-shm` (~8739 tok)
- `metadata.sqlite-wal` (~2206 tok)

## .wrangler/state/v3/do/agent-orchestrator-TaskManager/

- `metadata.sqlite-shm` (~8739 tok)
- `metadata.sqlite-wal` (~2206 tok)

## .wrangler/state/v3/kv/miniflare-KVNamespaceObject/

- `metadata.sqlite-shm` (~8739 tok)
- `metadata.sqlite-wal` (~2206 tok)

## .wrangler/tmp/bundle-MKSdcU/

- `middleware-insertion-facade.js` — Exports __INTERNAL_WRANGLER_MIDDLEWARE__ (~236 tok)
- `middleware-loader.entry.ts` — This loads all middlewares exposed on the middleware object and then starts (~1217 tok)

## .wrangler/tmp/dev-dW785T/

- `index.js` — Zustand store (~255685 tok)

## docs/

- `agents.md` — Agent Types & Tool API (~2066 tok)
- `api-reference.md` — API Reference (~2013 tok)
- `architecture.md` — Architecture (~2524 tok)
- `configuration.md` — Configuration Reference (~1686 tok)
- `deployment.md` — Deployment Guide (~2136 tok)
- `docker.md` — Docker & Docker Compose (~1638 tok)
- `research-brief.md` — Research Brief: Cloudflare Dynamic Workers (~2468 tok)
- `security.md` — Security Model (~1610 tok)
- `technical-summary.md` — Technical Summary — Platform-Agnostic Orchestrator + Crypto-Payments Example (~1533 tok)

## examples/crypto-payments/

- `package.json` — Node.js package manifest (~145 tok)
- `README.md` — Project documentation (~1176 tok)
- `tsconfig.json` — TypeScript configuration (~116 tok)

## examples/crypto-payments/src/

- `config.ts` — Exports AppConfig, loadConfig (~364 tok)
- `crypto.ts` — Compute a hex HMAC-SHA256 of `payload` with `secret`. (~201 tok)
- `main.ts` — Executable entry point for the crypto-payments example. (~202 tok)
- `money.test.ts` (~310 tok)
- `money.ts` — Currency-aware conversion between integer minor units and the decimal (~503 tok)
- `payment-service.test.ts` — Declares service (~488 tok)
- `payment-service.ts` — Thin application service over a {@link PaymentProvider}. All business logic (~550 tok)
- `server.ts` — Provider-agnostic REST routing. Returns null for unknown routes. The webhook (~1314 tok)
- `types.ts` — Payment domain types + the PaymentProvider port. (~868 tok)

## examples/crypto-payments/src/providers/

- `coinbase.ts` — Coinbase Commerce timeline status -> normalized status. (~1315 tok)
- `mock.ts` — Deterministic, network-free provider for local demos and tests. Charges are (~765 tok)
- `paypal.test.ts` — Build a fetch stub that routes by URL path. PayPal calls the OAuth token (~1107 tok)
- `paypal.ts` — PayPal adapter using the Orders API v2. Unlike Stripe/Coinbase (local HMAC), (~1884 tok)
- `registry.test.ts` — Declares provider (~1202 tok)
- `registry.ts` — Build a {@link PaymentProvider} from an id + credentials. Adding a provider (~457 tok)
- `stripe.ts` — Max age (seconds) allowed for a webhook timestamp; guards replay. (~1656 tok)

## examples/fastapi-crypto-terminal/

- `docker-compose.yml` — Docker Compose services (~64 tok)
- `Dockerfile` — Docker container definition (~56 tok)
- `README.md` — Project documentation (~748 tok)
- `requirements.txt` — Python dependencies (~29 tok)

## examples/fastapi-crypto-terminal/app/

- `__init__.py` (~0 tok)
- `config.py` — Declares Settings (~242 tok)
- `main.py` — FastAPI Crypto Price Terminal — powered by Dynamic Workers. (~2318 tok)
- `models.py` — Declares CoinPrice (~364 tok)
- `orchestrator.py` — Client for the Dynamic Workers Agent Orchestrator API. (~2707 tok)
- `prices.py` — Live crypto price fetcher using the CoinGecko free API. (~1023 tok)

## examples/fastapi-crypto-terminal/app/static/

- `.gitkeep` (~0 tok)

## examples/fastapi-crypto-terminal/app/templates/

- `terminal.html` — Crypto Terminal — Dynamic Workers (~3560 tok)

## examples/task-ui/

- `.dockerignore` (~7 tok)
- `.env.example` — VITE_ORCHESTRATOR_URL env variable (~71 tok)
- `Dockerfile` — Docker container definition (~45 tok)
- `index.html` — SPA entry point (~131 tok)
- `index.html` — Dynamic Workers — Task UI (~131 tok)
- `package.json` — Vite+React19+TS task UI; deps: tanstack-query, react-hook-form, zod, hljs, react-router (~218 tok)
- `package.json` — Node.js package manifest (~218 tok)
- `README.md` — Setup, CORS options, env vars, project structure (~782 tok)
- `README.md` — Project documentation (~733 tok)
- `tsconfig.json` — TypeScript strict config targeting ES2020 (~129 tok)
- `tsconfig.json` — TypeScript configuration (~129 tok)
- `vite.config.ts` — https://vite.dev/config/ (~177 tok)
- `vite.config.ts` — https://vite.dev/config/ (~172 tok)

## examples/task-ui/src/

- `App.tsx` — QueryClientProvider + BrowserRouter; manages recentTaskIds state across routes (~370 tok)
- `App.tsx` — queryClient (~370 tok)
- `index.css` — @import "tailwindcss" + highlight.js github-dark theme import (~71 tok)
- `index.css` — Styles: 3 rules (~71 tok)
- `main.tsx` — React 19 createRoot entry (~85 tok)
- `main.tsx` — root (~85 tok)

## examples/task-ui/src/api/

- `client.ts` — Typed fetch wrappers: submitTasks, getTask, submitReview, getUsage, getWsBase (~480 tok)
- `client.ts` — Derive the WebSocket base URL from the HTTP base URL. (~480 tok)
- `types.ts` — All shared types mirroring src/types.ts: AgentType, TaskState, LogEntry, ReviewDecision, etc. (~735 tok)
- `types.ts` — Mirrors src/types.ts from the orchestrator Worker. (~735 tok)

## examples/task-ui/src/components/

- `LogStream.tsx` — Terminal-style log viewer: auto-scroll, copy-all, level colorization, connected indicator (~1187 tok)
- `LogStream.tsx` — LEVEL_COLORS (~1187 tok)
- `ReviewPanel.tsx` — Human-in-the-loop panel: approve/reject/revise with highlight.js diff viewer (~2447 tok)
- `ReviewPanel.tsx` — DiffViewer (~2447 tok)
- `TaskCard.tsx` — Live task status card: subtask list, cost, color-coded badges, PR link; exports TaskCardSkeleton (~2006 tok)
- `TaskCard.tsx` — When true, shows a "View details" link. Set to false on the TaskPage itself. (~2006 tok)
- `TaskForm.tsx` — Task submission form: description, agentType select, repo fields, file editor, advanced accordion (~4520 tok)
- `TaskForm.tsx` — --------------------------------------------------------------------------- (~4520 tok)
- `UsageSidebar.tsx` — Token/cost summary sidebar; polls /usage 30s; today/7days/all time filter (~1122 tok)
- `UsageSidebar.tsx` — FILTER_LABELS (~1122 tok)

## examples/task-ui/src/hooks/

- `useTask.ts` — useQuery for GET /tasks/:id; polls 2s while active status, stops on terminal status (~204 tok)
- `useTask.ts` — Exports useTask (~204 tok)
- `useTaskStream.ts` — WebSocket hook for /tasks/:id/stream; exponential backoff, 500-line cap, mounted guard (~704 tok)
- `useTaskStream.ts` — Exports useTaskStream (~704 tok)
- `useUsage.ts` — useQuery for GET /usage with TimeFilter (today/7days/all), 30s refetch interval (~161 tok)
- `useUsage.ts` — Exports TimeFilter, useUsage (~161 tok)

## examples/task-ui/src/pages/

- `HomePage.tsx` — Split layout: TaskForm left, task list + UsageSidebar right; includes TaskLookup widget (~1542 tok)
- `HomePage.tsx` — --------------------------------------------------------------------------- (~1542 tok)
- `TaskPage.tsx` — Task detail page: TaskCard + LogStream + ReviewPanel + per-subtask results panel (~2387 tok)
- `TaskPage.tsx` — ErrorBanner (~2387 tok)

## src/

- `env.d.ts` — Declares Env (~218 tok)
- `gateway.test.ts` — HttpGateway tests. These exercise the egress allow-list, credential (~1622 tok)
- `gateway.ts` — HttpGateway — intercepts every outbound fetch() and connect() from (~817 tok)
- `index.test.ts` — Router tests for the orchestrator Worker. These drive default.fetch() (~3028 tok)
- `index.ts` — Agent Orchestrator — main entry point. (~6823 tok)
- `observability.test.ts` — LogSession + DynamicWorkerTail tests. (~1844 tok)
- `observability.ts` — API routes: GET (1 endpoints) (~1264 tok)
- `state.test.ts` — TaskManager + CostTracker DO tests. The in-memory storage fake from (~3216 tok)
- `state.ts` — API routes: PUT (2 endpoints) (~1558 tok)
- `types.ts` — FileSystem binding — scoped to a specific repository directory. (~1708 tok)

## src/agents/

- `codegen.ts` — CodeGen Agent — generates new code from a natural language spec and file context. (~1739 tok)
- `review.ts` — Review Agent — performs code review, identifies bugs, suggests improvements. (~1914 tok)
- `runners.test.ts` — Unit tests for the in-process agent runners (the no-Cloudflare execution (~1736 tok)
- `runners.ts` — In-process agent implementations (codegen / test / review). (~2302 tok)
- `source.test.ts` — Agent source registry: each AgentType maps to the right embedded source (~404 tok)
- `source.ts` — Agent source code registry — returns the TypeScript source for each agent type. (~3610 tok)
- `test.ts` — Test Agent — writes and validates unit/integration tests. (~1898 tok)

## src/bindings/

- `filesystem.test.ts` — FileSystem binding tests. Every method hits the GitHub Contents API via (~1664 tok)
- `filesystem.ts` — FileSystem RPC binding — exposes read/write/list/delete scoped to a GitHub repo. (~1100 tok)
- `git.test.ts` — Git binding tests. The commit path chains four GitHub API calls (~2676 tok)
- `git.ts` — Git RPC binding — exposes branch, commit, diff, push operations (~1843 tok)
- `llm.test.ts` — LLM binding tests — provider routing, credential placement, retry/backoff (~1749 tok)
- `llm.ts` — Optional base URL override for OpenAI-compatible / self-hosted models. (~411 tok)
- `memory.test.ts` — Memory binding tests — namespace scoping, TTL, list-prefix stripping. (~537 tok)
- `memory.ts` — Memory RPC binding — persists learnings, conventions, and context (~385 tok)
- `search.test.ts` — CodeSearch binding tests. Covers grep pattern assembly, glob-to-regex for (~1212 tok)
- `search.ts` — CodeSearch RPC binding — search code, find files, and extract symbols (~1466 tok)

## src/core/

- `decompose.test.ts` — Unit tests for task decomposition — the pure task -> subtask fan-out. (~447 tok)
- `decompose.ts` — Break a task request into a dependency graph of subtasks. Pure and (~458 tok)
- `id.test.ts` — Unit tests for the runtime-neutral id helpers, covering both the Web Crypto (~423 tok)
- `memory-state-store.test.ts` — Unit tests for InMemoryStateStore — the non-durable StateStore used by the (~1232 tok)
- `memory-state-store.ts` — Non-durable, in-process StateStore for local dev, tests, and single-node (~905 tok)
- `orchestrator.test.ts` — Orchestrator core tests — dependency-wave scheduling, self-heal, review (~2873 tok)
- `orchestrator.ts` — Max agents allowed to run concurrently across all in-flight tasks. (~2603 tok)
- `ports.ts` — Ports (interfaces) for the runtime-neutral orchestration core. Adapters live (~455 tok)
- `semaphore.test.ts` — Declares sem (~312 tok)
- `semaphore.ts` — Minimal counting semaphore used to bound how many agents run concurrently. (~309 tok)
- `state-machine.test.ts` — Unit tests for the runtime-neutral state-machine helpers: transition (~728 tok)
- `state-machine.ts` — Runtime-neutral task state-machine helpers. (~478 tok)

## src/local/

- `config.test.ts` — Declares cfg (~411 tok)
- `config.ts` — Environment-driven configuration for the local (no-Cloudflare) runtime. (~398 tok)
- `log-hub.test.ts` — Unit tests for LogHub — the in-process log buffer + fan-out backing SSE. (~425 tok)
- `log-hub.ts` — In-process log sink + fan-out. The local counterpart of the Cloudflare (~336 tok)
- `main.ts` — Executable entry point for the local (no-Cloudflare) runtime. (~71 tok)
- `server.node.test.ts` — End-to-end tests for the local Node HTTP server (createNodeServer): CORS (~1178 tok)
- `server.test.ts` — REST routing tests for the local server. Drives handleRest() directly with a (~1114 tok)
- `server.ts` — Local HTTP server — the no-Cloudflare entry point. Exposes the same REST (~1720 tok)

## src/providers/llm/

- `anthropic.ts` — Anthropic Messages API adapter (`POST /v1/messages`). System messages are (~707 tok)
- `index.ts` (~146 tok)
- `openai-compatible.ts` — Adapter for any OpenAI Chat Completions-compatible endpoint (~702 tok)
- `pricing.test.ts` (~239 tok)
- `pricing.ts` — Per-model pricing table (USD per 1M tokens). Used to estimate cost from (~603 tok)
- `registry.test.ts` — Provider registry + adapter tests. fetch is stubbed via the shared route (~1558 tok)
- `registry.ts` — Build an {@link LlmProvider} from configuration. Adding a new provider is a (~623 tok)
- `retry.test.ts` — Deterministic: inject a no-op sleep so no wall-clock time passes. (~382 tok)
- `retry.ts` — HTTP status codes / substrings that indicate a transient, retryable error. (~479 tok)
- `types.ts` — Provider-agnostic LLM layer. (~484 tok)

## src/runtime/

- `egress.test.ts` — API routes: GET (4 endpoints) (~524 tok)
- `egress.ts` — Runtime-neutral egress policy: a domain allowlist plus credential injection. (~655 tok)
- `local.test.ts` — LocalRuntime tests — verify an agent runs in-process against a stubbed LLM (~1559 tok)
- `local.ts` — LocalRuntime — runs agents in-process against injected capability bindings. (~1540 tok)

## tests/e2e/

- `errors.spec.ts` — Error-path smoke: malformed input, unknown ids, and invalid verbs. (~432 tok)
- `fixtures.ts` — Shared Playwright fixtures for the e2e suite. (~484 tok)
- `perf.spec.ts` — Performance sanity check — submit N tasks concurrently, assert that no (~444 tok)
- `rest.spec.ts` — REST smoke tests — hit the live wrangler dev server across every public (~469 tok)
- `websocket.spec.ts` — WebSocket streaming. Uses the `ws` npm client (not the browser's WebSocket) (~713 tok)

## tests/helpers/

- `clock.ts` — Virtual clock used by the KV TTL simulation and anywhere tests need to (~188 tok)
- `cloudflare-workers.ts` — Shim for the virtual `cloudflare:workers` module — loaded by jest via (~594 tok)
- `ctx.ts` — ExecutionContext fake: tracks waitUntil() promises so tests can await (~378 tok)
- `do.ts` — Durable Object namespace + stub fakes. (~688 tok)
- `env.ts` — Test env factory — composes the individual fakes into an object shaped (~1004 tok)
- `fetch.ts` — Route-based fetch stub. Tests register matchers against (~1032 tok)
- `kv.ts` — In-memory KVNamespace fake. Implements the subset of the KV API used by (~756 tok)
- `loader.ts` — Fake implementation of the Worker Loader binding. src/index.ts calls (~413 tok)
- `setup-worker-globals.ts` — Jest setup: install Cloudflare Workers runtime globals that Node/undici does (~502 tok)
- `storage.ts` — Minimal in-memory DurableObjectStorage shaped after the subset used by (~242 tok)
- `worker-bundler.ts` — Shim for @cloudflare/worker-bundler — redirected by jest's moduleNameMapper. (~139 tok)
- `ws.ts` — WebSocketPair shim for Node-side tests of observability.ts. The real (~728 tok)

## tests/integration/

- `cost-aggregation.test.ts` — Integration: cost tracking. After a full codegen run the /usage endpoint (~771 tok)
- `memory-persistence.test.ts` — Integration: KV-backed agent memory survives across tasks. We write a (~490 tok)
- `retry-self-heal.test.ts` — Integration: retry + self-healing. The first CodeGen invocation returns (~812 tok)
- `review-reject.test.ts` — Integration: review rejection path. The task ends up in failed state with (~698 tok)
- `task-lifecycle.test.ts` — Integration: full task lifecycle — create → run → review → approve → PR. (~1082 tok)
