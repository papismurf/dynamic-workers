# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-04-23T20:26:46.735Z
> Files: 101 tracked | Anatomy hits: 0 | Misses: 0

## ./

- `.dev.vars` — Copy to .dev.vars for local development (read by `wrangler dev`) and/or (~318 tok)
- `.dockerignore` — Docker ignore rules (~41 tok)
- `.gitignore` — Git ignore rules (~19 tok)
- `CLAUDE.md` — OpenWolf (~57 tok)
- `docker-compose.dev.yml` — Development override — runs `wrangler dev` with hot reload. (~379 tok)
- `docker-compose.prod.yml` — Production override — runs `wrangler deploy` against Cloudflare. (~411 tok)
- `docker-compose.yml` — Docker Compose services (~231 tok)
- `Dockerfile` — Docker container definition (~478 tok)
- `jest.config.ts` — Jest test configuration (~901 tok)
- `LICENSE` — Project license (~4296 tok)
- `package-lock.json` — npm lock file (~55962 tok)
- `package.json` — Node.js package manifest (~410 tok)
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

- `claude-code-review.yml` — /*.ts" (~422 tok)
- `claude.yml` — CI: Claude Code (~554 tok)

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

## src/

- `env.d.ts` — Declares Env (~218 tok)
- `gateway.test.ts` — HttpGateway tests. These exercise the egress allow-list, credential (~1622 tok)
- `gateway.ts` — HttpGateway — intercepts every outbound fetch() and connect() from (~817 tok)
- `index.test.ts` — Router tests for the orchestrator Worker. These drive default.fetch() (~3028 tok)
- `index.ts` — Agent Orchestrator — main entry point. (~6527 tok)
- `observability.test.ts` — LogSession + DynamicWorkerTail tests. (~1844 tok)
- `observability.ts` — API routes: GET (1 endpoints) (~1264 tok)
- `state.test.ts` — TaskManager + CostTracker DO tests. The in-memory storage fake from (~3216 tok)
- `state.ts` — API routes: PUT (2 endpoints) (~1558 tok)
- `types.ts` — FileSystem binding — scoped to a specific repository directory. (~1708 tok)

## src/agents/

- `codegen.ts` — CodeGen Agent — generates new code from a natural language spec and file context. (~1739 tok)
- `review.ts` — Review Agent — performs code review, identifies bugs, suggests improvements. (~1914 tok)
- `source.test.ts` — Agent source registry: each AgentType maps to the right embedded source (~404 tok)
- `source.ts` — Agent source code registry — returns the TypeScript source for each agent type. (~3610 tok)
- `test.ts` — Test Agent — writes and validates unit/integration tests. (~1898 tok)

## src/bindings/

- `filesystem.test.ts` — FileSystem binding tests. Every method hits the GitHub Contents API via (~1664 tok)
- `filesystem.ts` — FileSystem RPC binding — exposes read/write/list/delete scoped to a GitHub repo. (~1100 tok)
- `git.test.ts` — Git binding tests. The commit path chains four GitHub API calls (~1890 tok)
- `git.ts` — Git RPC binding — exposes branch, commit, diff, push operations (~1843 tok)
- `llm.test.ts` — LLM binding tests — provider routing, credential placement, retry/backoff (~1749 tok)
- `llm.ts` — LLM RPC binding — wraps AI provider APIs with managed credentials, (~1452 tok)
- `memory.test.ts` — Memory binding tests — namespace scoping, TTL, list-prefix stripping. (~537 tok)
- `memory.ts` — Memory RPC binding — persists learnings, conventions, and context (~385 tok)
- `search.test.ts` — CodeSearch binding tests. Covers grep pattern assembly, glob-to-regex for (~1212 tok)
- `search.ts` — CodeSearch RPC binding — search code, find files, and extract symbols (~1466 tok)

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
- `storage.ts` — Minimal in-memory DurableObjectStorage shaped after the subset used by (~242 tok)
- `worker-bundler.ts` — Shim for @cloudflare/worker-bundler — redirected by jest's moduleNameMapper. (~139 tok)
- `ws.ts` — WebSocketPair shim for Node-side tests of observability.ts. The real (~728 tok)

## tests/integration/

- `cost-aggregation.test.ts` — Integration: cost tracking. After a full codegen run the /usage endpoint (~771 tok)
- `memory-persistence.test.ts` — Integration: KV-backed agent memory survives across tasks. We write a (~490 tok)
- `retry-self-heal.test.ts` — Integration: retry + self-healing. The first CodeGen invocation returns (~812 tok)
- `review-reject.test.ts` — Integration: review rejection path. The task ends up in failed state with (~698 tok)
- `task-lifecycle.test.ts` — Integration: full task lifecycle — create → run → review → approve → PR. (~1082 tok)
