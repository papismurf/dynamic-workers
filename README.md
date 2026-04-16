# Agent Orchestrator

An AI agent orchestration platform built on [Cloudflare Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/). Deploy autonomous software development agents — code generation, testing, code review, refactoring, debugging — in sandboxed V8 isolates that start in milliseconds.

Each agent runs in its own Dynamic Worker with controlled network access, capability-based bindings, and full observability. No containers. No cold-start penalty. 100+ concurrent agents.

![logo header](.github\assets\puppeteer_agent_light_wide.svg)

---

## How It Works

1. **You submit a task** — a description, target repo, and agent type.
2. **The orchestrator decomposes it** — a `codegen` task spawns CodeGen → Test → Review subtasks with dependency ordering.
3. **Agents run in sandboxed Dynamic Workers** — each with scoped file system, Git, LLM, and search bindings. Agents never see credentials.
4. **Results aggregate** — when all subtasks pass, the task enters a human review gate.
5. **You approve** — the orchestrator creates a GitHub PR with the agent's changes.

```
POST /tasks → Orchestrator → Dynamic Workers (agents) → Human Review → GitHub PR
```

---

## Features

| Feature | Description |
|---|---|
| **6 Agent Types** | CodeGen, Test, Review, Refactor, Debug, Dependency |
| **Sandboxed Execution** | Each agent in an isolated V8 isolate with egress firewall |
| **Capability-Based Security** | Agents only access resources they're explicitly given (Cap'n Web RPC) |
| **Credential Injection** | GitHub PATs and API keys injected at the gateway, invisible to agents |
| **Self-Healing** | Failed agents automatically retry with error context (exponential backoff) |
| **Human-in-the-Loop** | Review gate — approve, reject, or request revisions before PR creation |
| **Real-Time Streaming** | WebSocket endpoint for live agent logs |
| **Cost Tracking** | Per-task token usage, CPU time, and dollar estimates |
| **Agent Memory** | KV-backed persistent memory for coding conventions and patterns |
| **Multi-Repo** | Per-repo credential scoping and branch isolation |

---

## Quick Start

### Prerequisites

- Node.js >= 18
- Cloudflare account (Paid plan for Durable Objects + KV)
- API key for Anthropic and/or OpenAI
- GitHub Personal Access Token

### Local Development

```bash
# Install dependencies
npm install

# Create .dev.vars with your secrets
cat > .dev.vars << 'EOF'
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GITHUB_PAT=ghp_...
EOF

# Start local dev server
npm run dev
# → http://localhost:8787

# Verify
curl http://localhost:8787/health
```

### Local Development with Docker

If you'd rather not install Node/wrangler on the host:

```bash
cp .env.example .dev.vars   # fill in your API keys
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
# → http://localhost:8787  (hot reload enabled via source bind-mount)
```

See [docs/docker.md](docs/docker.md) for the full Compose guide, including
deploying to Cloudflare from a pinned toolchain image.

### Production Deployment

```bash
# Create KV namespaces (copy IDs into wrangler.jsonc)
wrangler kv namespace create AGENT_MEMORY
wrangler kv namespace create REPO_CREDENTIALS

# Set secrets
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put GITHUB_PAT

# Deploy
npm run deploy

# Verify
curl https://agent-orchestrator.<your-subdomain>.workers.dev/health
```

---

## Usage

### Create a Task

```bash
curl -X POST https://your-worker.workers.dev/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [{
      "description": "Add rate limiting middleware to the Express API",
      "agentType": "codegen",
      "repo": {
        "owner": "myorg",
        "repo": "my-api",
        "branch": "agent/rate-limiter",
        "baseBranch": "main",
        "files": {
          "src/middleware/auth.ts": "...existing code..."
        }
      }
    }]
  }'
```

### Poll Status

```bash
curl https://your-worker.workers.dev/tasks/<task-id>
```

### Stream Logs (WebSocket)

```javascript
const ws = new WebSocket("wss://your-worker.workers.dev/tasks/<task-id>/stream");
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

### Approve for PR

```bash
curl -X POST https://your-worker.workers.dev/tasks/<task-id>/review \
  -H "Content-Type: application/json" \
  -d '{ "taskId": "<task-id>", "decision": "approve" }'
```

### Check Costs

```bash
curl https://your-worker.workers.dev/usage
```

---

## CI/CD Integration

### GitHub Actions Deploy Pipeline

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npm run typecheck

  deploy:
    needs: typecheck
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

### Agent-Driven CI Repair

Agents can also be triggered by CI failures to automatically diagnose and fix broken builds:

```yaml
  auto-fix:
    if: failure()
    needs: test
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST https://your-worker.workers.dev/tasks \
            -H "Content-Type: application/json" \
            -d '{
              "tasks": [{
                "description": "Fix CI failure: ${{ steps.test.outputs.error }}",
                "agentType": "debug",
                "repo": {
                  "owner": "${{ github.repository_owner }}",
                  "repo": "${{ github.event.repository.name }}",
                  "branch": "agent/fix-${{ github.run_id }}",
                  "baseBranch": "${{ github.head_ref }}",
                  "files": {}
                }
              }]
            }'
```

See [docs/deployment.md](docs/deployment.md) for the full CI/CD guide including staging environments and smoke tests.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/tasks` | Create tasks |
| `GET` | `/tasks/:id` | Get task status |
| `POST` | `/tasks/:id/review` | Submit review decision |
| `WS` | `/tasks/:id/stream` | Real-time log stream |
| `GET` | `/usage` | Cost tracking |

Full API documentation: [docs/api-reference.md](docs/api-reference.md)

---

## Project Structure

```
.
├── wrangler.jsonc                 # Cloudflare Worker configuration
├── package.json                   # Dependencies and scripts
├── tsconfig.json                  # TypeScript (strict mode)
├── Dockerfile                     # Multi-stage: dev / typecheck / prod deploy
├── docker-compose.yml             # Base Compose service definition
├── docker-compose.dev.yml         # Dev override (wrangler dev + hot reload)
├── docker-compose.prod.yml        # Prod override (wrangler deploy)
├── .env.example                   # Template for .dev.vars and .env
├── docs/
│   ├── architecture.md            # System design and data flow
│   ├── research-brief.md          # Dynamic Workers platform research
│   ├── api-reference.md           # Full HTTP API documentation
│   ├── agents.md                  # Agent types and tool API
│   ├── security.md                # Security model and egress control
│   ├── deployment.md              # Local dev, production, and CI/CD
│   ├── docker.md                  # Docker Compose usage and deploy workflow
│   └── configuration.md           # Wrangler config and tuning guide
├── src/
│   ├── index.ts                   # Orchestrator Worker (main entry)
│   ├── types.ts                   # Shared type definitions
│   ├── env.d.ts                   # Generated environment types
│   ├── state.ts                   # TaskManager + CostTracker DOs
│   ├── observability.ts           # DynamicWorkerTail + LogSession DO
│   ├── gateway.ts                 # HttpGateway egress control
│   ├── agents/
│   │   ├── source.ts              # Agent source code registry
│   │   ├── codegen.ts             # CodeGen Agent (reference)
│   │   ├── test.ts                # Test Agent (reference)
│   │   └── review.ts              # Review Agent (reference)
│   └── bindings/
│       ├── filesystem.ts          # FileSystem RPC binding
│       ├── git.ts                 # Git RPC binding
│       ├── llm.ts                 # LLM RPC binding
│       ├── search.ts              # CodeSearch RPC binding
│       └── memory.ts              # Memory RPC binding
```

---

## Documentation

| Document | Description |
|---|---|
| [Architecture](docs/architecture.md) | System design, component map, data flow, state machine |
| [Research Brief](docs/research-brief.md) | Cloudflare Dynamic Workers deep research findings |
| [API Reference](docs/api-reference.md) | Full HTTP/WebSocket API documentation |
| [Agents](docs/agents.md) | Agent types, tool API interfaces, how to add new agents |
| [Security](docs/security.md) | Sandboxing, egress control, credential separation, threat model |
| [Deployment](docs/deployment.md) | Local dev, production deploy, CI/CD pipelines |
| [Docker](docs/docker.md) | Containerized dev server and pinned deploy toolchain via Docker Compose |
| [Configuration](docs/configuration.md) | Wrangler config, secrets, tuning guide, multi-environment |

---

## Scripts

| Script | Command | Description |
|---|---|---|
| `dev` | `npm run dev` | Start local development server |
| `deploy` | `npm run deploy` | Deploy to Cloudflare |
| `typecheck` | `npm run typecheck` | Run TypeScript type checker |
| `types` | `npm run types` | Regenerate `env.d.ts` from wrangler config |
| `tail` | `npm run tail` | Stream live production logs |

---

## License

Copyright (c) 2026 David Brown. All rights reserved. David Brown is the sole owner and copyright holder of this software.

This project is dual-licensed:

| License | Use Case |
|---|---|
| **Community License** (Apache 2.0 + Commons Clause) | Non-commercial use, personal projects, research, education, evaluation |
| **Commercial License** | Production commercial use, SaaS deployment, redistribution in commercial products |

The Community License grants full Apache 2.0 freedoms (including an explicit patent grant) with the Commons Clause restriction that prohibits selling the software or offering it as a paid service. All contributions are assigned to the copyright holder under the Contributor License Agreement in the LICENSE file.

For commercial licensing inquiries, contact David Brown via [GitHub](https://github.com/papismurf).

See [LICENSE](LICENSE) for the full terms.
