# Agent Orchestrator v0.1.0 — Initial Release 🚀

The first public release of **Agent Orchestrator** — an AI agent orchestration platform for autonomous software development. Submit a task, and the orchestrator decomposes it into a dependency graph of agents (code generation → testing → review), runs them concurrently with self-healing retries, gates the result behind human review, and opens a GitHub PR on approval.

## ✨ Highlights

### Platform-agnostic core — run it anywhere
The orchestration engine is built on a ports-and-adapters architecture, so the same scheduling logic runs on two runtimes with an identical HTTP API:

- **Cloudflare edge** — each agent executes in its own sandboxed [Dynamic Worker](https://developers.cloudflare.com/dynamic-workers/) (isolated V8 isolate, egress firewall, millisecond cold starts, 100+ concurrent agents), with Durable Objects for state and WebSocket log streaming.
- **Local Node** — the full orchestrator on your machine with **no Cloudflare account**: in-process agent runners, in-memory state store, egress-guarded `fetch`, and SSE log streaming. Start it with `npm run dev:local`.

### Pluggable LLM providers
Switch model backends by configuration, not code: **Anthropic, OpenAI, DeepSeek, Ollama**, or any OpenAI-compatible / self-hosted endpoint (vLLM, LM Studio, Together, Groq). Includes per-model cost estimation and retry with exponential backoff + jitter.

### Multi-agent orchestration
- **6 agent types** — CodeGen, Test, Review, Refactor, Debug, Dependency
- **Dependency-aware wave scheduling** bounded by a counting semaphore (rate-limit safe)
- **Self-healing** — failed agents automatically retry with error context
- **Human-in-the-loop review gate** — approve, reject, or request revisions before any PR is created

### Security model
- **Sandboxed execution** — on Cloudflare, every agent runs in an isolated V8 isolate behind an egress domain allowlist
- **Capability-based access** — agents only receive the bindings they're explicitly granted (file system, Git, LLM, code search, memory)
- **Credential injection at the gateway** — GitHub PATs and API keys are injected at the egress layer and are never visible to agent code

### Observability & cost tracking
- Real-time log streaming — WebSocket on the edge runtime, SSE on the local runtime
- Per-task token usage, CPU time, and dollar-cost estimates via `GET /usage`
- KV-backed persistent agent memory for coding conventions and patterns

## 📦 What's included

- **HTTP API** — `POST /tasks`, `GET /tasks/:id`, `POST /tasks/:id/review`, `/tasks/:id/stream`, `GET /usage`, `GET /health`
- **Docker support** — multi-stage Dockerfile plus Compose overrides for dev (hot reload) and production deploy
- **CI/CD recipes** — GitHub Actions deploy pipeline and an agent-driven CI auto-repair workflow
- **Examples**
  - [`crypto-payments`](examples/crypto-payments/) — the same ports-and-adapters pattern applied to payments: swap Stripe / PayPal / Coinbase Commerce / Mock via one env var, with webhook signature verification and integer minor-unit money handling
  - [`task-ui`](examples/task-ui/) — React 19 + Vite UI for submitting tasks, watching live logs, and reviewing diffs
  - [`fastapi-crypto-terminal`](examples/fastapi-crypto-terminal/) — FastAPI client that drives the orchestrator API
- **Documentation** — [architecture](docs/architecture.md), [API reference](docs/api-reference.md), [agents](docs/agents.md), [security model](docs/security.md), [deployment](docs/deployment.md), [configuration](docs/configuration.md), and four [ADRs](docs/adr/) covering the runtime, LLM, payment, and state/observability abstractions

## ✅ Quality

- Unit + integration test suites (Jest) covering the task lifecycle, cost aggregation, retry/self-heal, review rejection, and memory persistence
- Playwright e2e suite (REST, WebSocket streaming, error paths, concurrency sanity)
- Strict TypeScript across three build surfaces (Worker, local Node runtime, tests) with a root CI quality gate

## 🚀 Getting started

```bash
npm install

# Local Node runtime — no Cloudflare account needed
export LLM_PROVIDER=anthropic
export LLM_API_KEY=sk-ant-...
export GITHUB_PAT=ghp_...
npm run dev:local
# → http://127.0.0.1:8787

curl http://127.0.0.1:8787/health
```

See the [README](README.md) for the Cloudflare edge runtime, Docker, and production deployment.

## 📄 License

Dual-licensed: **Community License** (Apache 2.0 + Commons Clause) for non-commercial use, research, and evaluation; **Commercial License** for production commercial use. See [LICENSE](LICENSE).

---

**Full changelog**: initial release.
