# Deployment Guide

This guide covers local development, production deployment, environment configuration, and CI/CD integration.

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| [Node.js](https://nodejs.org/) | >= 18 | Runtime for Wrangler CLI |
| [Wrangler](https://developers.cloudflare.com/workers/wrangler/) | >= 4.x | Cloudflare Workers CLI |
| [Cloudflare Account](https://dash.cloudflare.com/) | Paid Plan | Workers, Durable Objects, KV require the paid plan |

---

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Create a local environment file

Create `.dev.vars` in the project root (this file is gitignored):

```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GITHUB_PAT=ghp_...
```

### 3. Start the dev server

```bash
npm run dev
```

This starts Wrangler's local development server at `http://localhost:8787` with:
- Hot reloading on source changes
- Local Durable Object storage (SQLite-backed)
- Local KV namespace simulation
- All Worker Loader bindings functional

### 4. Test the health endpoint

```bash
curl http://localhost:8787/health
```

### 5. Submit a test task

```bash
curl -X POST http://localhost:8787/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [{
      "description": "Create a hello world function",
      "agentType": "codegen",
      "repo": {
        "owner": "your-org",
        "repo": "your-repo",
        "branch": "agent/hello-world",
        "baseBranch": "main",
        "files": {}
      }
    }]
  }'
```

### 6. Type checking

```bash
npm run typecheck
```

### 7. View real-time logs

In a separate terminal:

```bash
npm run tail
```

This streams live logs from the deployed Worker using `wrangler tail`.

---

## Production Deployment

### 1. Create KV namespaces

```bash
wrangler kv namespace create AGENT_MEMORY
wrangler kv namespace create REPO_CREDENTIALS
```

Copy the namespace IDs from the output into `wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  { "binding": "AGENT_MEMORY", "id": "your-agent-memory-id-here" },
  { "binding": "REPO_CREDENTIALS", "id": "your-repo-credentials-id-here" }
]
```

### 2. Set secrets

```bash
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put GITHUB_PAT
```

Each command prompts for the value interactively. Secrets are encrypted at rest and only available to the Worker at runtime.

### 3. Deploy

```bash
npm run deploy
```

This runs `wrangler deploy`, which:
- Compiles TypeScript via esbuild
- Uploads the Worker bundle to Cloudflare's edge
- Creates/updates Durable Object classes (based on migrations)
- Binds KV namespaces and Worker Loader

### 4. Verify

```bash
curl https://agent-orchestrator.<your-subdomain>.workers.dev/health
```

Expected response:

```json
{
  "service": "agent-orchestrator",
  "status": "healthy",
  "version": "0.1.0"
}
```

### 5. Monitor

View live production logs:

```bash
wrangler tail
```

Or query Workers Logs in the Cloudflare dashboard under **Workers & Pages > agent-orchestrator > Logs**.

---

## Environment Variables

### Secrets (set via `wrangler secret put`)

| Name | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes* | Anthropic API key for Claude models |
| `OPENAI_API_KEY` | Yes* | OpenAI API key for GPT models |
| `GITHUB_PAT` | Yes | GitHub Personal Access Token with `contents:write` and `pull_requests:write` |

*At least one LLM provider key is required.

### Vars (set in `wrangler.jsonc`)

| Name | Default | Description |
|---|---|---|
| `DEFAULT_LLM_MODEL` | `claude-sonnet-4-20250514` | Default model for agent LLM calls |
| `DEFAULT_LLM_PROVIDER` | `anthropic` | Default provider (`anthropic` or `openai`) |
| `MAX_AGENT_RETRIES` | `3` | Max self-heal retry attempts per failed subtask |
| `ALLOWED_EGRESS_DOMAINS` | (see below) | Comma-separated domain allowlist for agent outbound requests |

Default egress domains: `api.anthropic.com,api.openai.com,api.github.com,registry.npmjs.org`

---

## CI/CD Integration

### GitHub Actions

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy Agent Orchestrator

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  typecheck:
    name: Type Check
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
    name: Deploy to Cloudflare
    needs: typecheck
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - name: Deploy
        run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

### Required GitHub Secrets

| Secret | How to Create |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare Dashboard > My Profile > API Tokens > Create Token > "Edit Cloudflare Workers" template |

### Pipeline Stages

| Stage | Trigger | What It Does |
|---|---|---|
| **Type Check** | Every push and PR | Runs `tsc --noEmit` to catch type errors |
| **Deploy** | Push to `main` only | Runs `wrangler deploy` to ship to production |

### Extending the Pipeline

Add these stages as needed:

**Staging environment:**

```yaml
  deploy-staging:
    name: Deploy to Staging
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npx wrangler deploy --env staging
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

To support staging, add an environment block to `wrangler.jsonc`:

```jsonc
"env": {
  "staging": {
    "name": "agent-orchestrator-staging",
    "vars": {
      "DEFAULT_LLM_MODEL": "claude-sonnet-4-20250514",
      "MAX_AGENT_RETRIES": "1"
    }
  }
}
```

**Integration test after deploy:**

```yaml
  smoke-test:
    name: Smoke Test
    needs: deploy
    runs-on: ubuntu-latest
    steps:
      - name: Health check
        run: |
          STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://agent-orchestrator.${{ vars.CF_SUBDOMAIN }}.workers.dev/health)
          if [ "$STATUS" != "200" ]; then
            echo "Health check failed with status $STATUS"
            exit 1
          fi
```

### Agent-Driven CI/CD

The orchestrator can also be used as part of a CI/CD pipeline where **agents fix CI failures automatically**:

1. A GitHub Actions workflow detects a CI failure.
2. The workflow calls `POST /tasks` with:
   - `agentType: "debug"`
   - `description`: the CI failure output
   - `repo.files`: the relevant source files
3. The Debug Agent diagnoses the failure and proposes a fix.
4. A human reviews the fix via `POST /tasks/:id/review`.
5. On approval, the agent's commit is merged.

Example webhook integration:

```yaml
  auto-fix:
    name: Agent Auto-Fix
    if: failure()
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Trigger debug agent
        run: |
          curl -X POST https://agent-orchestrator.${{ vars.CF_SUBDOMAIN }}.workers.dev/tasks \
            -H "Content-Type: application/json" \
            -d '{
              "tasks": [{
                "description": "CI test failure: ${{ steps.test.outputs.error }}",
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

---

## Rollback

If a deployment causes issues:

```bash
# List recent deployments
wrangler deployments list

# Roll back to a previous version
wrangler rollback
```

Wrangler keeps a history of deployments and supports instant rollback.
