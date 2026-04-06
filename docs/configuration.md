# Configuration Reference

All configuration is managed through `wrangler.jsonc`, environment variables, and Wrangler secrets.

---

## wrangler.jsonc

The main configuration file. Here is each section explained.

### Worker Identity

```jsonc
{
  "name": "agent-orchestrator",   // Worker name (appears in the dashboard and URL)
  "main": "src/index.ts",         // Entry point — Wrangler compiles this with esbuild
  "compatibility_date": "2026-03-24",
  "compatibility_flags": ["nodejs_compat"]  // Enables Node.js APIs (Buffer, crypto, etc.)
}
```

### Worker Loader

```jsonc
{
  "worker_loaders": [{ "binding": "LOADER" }]
}
```

Provides `env.LOADER` — the API to create Dynamic Workers at runtime. No external resource to configure; it simply enables the capability.

### Durable Objects

```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "TASK_MANAGER", "class_name": "TaskManager" },
      { "name": "LOG_SESSION", "class_name": "LogSession" },
      { "name": "COST_TRACKER", "class_name": "CostTracker" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_classes": ["TaskManager", "LogSession", "CostTracker"] }
  ]
}
```

| DO | Purpose | Data Stored |
|---|---|---|
| `TaskManager` | Task lifecycle state machine | Task state, subtasks, results, cost |
| `LogSession` | Real-time log streaming | In-memory log buffer, WebSocket connections |
| `CostTracker` | Usage aggregation | Per-task cost records |

**Migrations:** When adding a new Durable Object class, add a migration entry with a new tag (e.g., `v2`) and the class name in `new_classes`. When renaming or deleting, use `renamed_classes` or `deleted_classes`.

### KV Namespaces

```jsonc
{
  "kv_namespaces": [
    { "binding": "AGENT_MEMORY", "id": "<namespace-id>" },
    { "binding": "REPO_CREDENTIALS", "id": "<namespace-id>" }
  ]
}
```

| Binding | Purpose |
|---|---|
| `AGENT_MEMORY` | Persistent storage for agent learnings (coding conventions, review patterns) |
| `REPO_CREDENTIALS` | Per-repo credential storage (future use for multi-repo scoped PATs) |

Create these with `wrangler kv namespace create <NAME>` and paste the IDs.

### Observability

```jsonc
{
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1  // 1 = capture 100% of requests
  }
}
```

This enables [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) for the orchestrator. Combined with Tail Workers on agent Dynamic Workers, this gives full observability into all agent activity.

Adjust `head_sampling_rate` to `0.1` (10%) or `0.01` (1%) in high-traffic production to reduce log volume.

### Environment Variables

```jsonc
{
  "vars": {
    "DEFAULT_LLM_MODEL": "claude-sonnet-4-20250514",
    "DEFAULT_LLM_PROVIDER": "anthropic",
    "MAX_AGENT_RETRIES": "3",
    "ALLOWED_EGRESS_DOMAINS": "api.anthropic.com,api.openai.com,api.github.com,registry.npmjs.org"
  }
}
```

These are non-secret configuration values. They can be overridden per-environment.

---

## Secrets

Secrets are set via the Wrangler CLI and encrypted at rest. They are available as `env.<SECRET_NAME>` at runtime.

```bash
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put GITHUB_PAT
```

| Secret | Description | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude | Yes (if using Anthropic) |
| `OPENAI_API_KEY` | OpenAI API key for GPT | Yes (if using OpenAI) |
| `GITHUB_PAT` | GitHub Personal Access Token | Yes |

### GitHub PAT Permissions

Use a **fine-grained PAT** scoped to specific repositories with these permissions:

| Permission | Access Level | Purpose |
|---|---|---|
| Contents | Read & Write | Read files, create commits |
| Pull requests | Read & Write | Create and update PRs |
| Metadata | Read-only | Repository info (auto-granted) |

---

## Tuning Guide

### LLM Model Selection

| Model | Speed | Quality | Cost | Best For |
|---|---|---|---|---|
| `claude-sonnet-4-20250514` | Fast | High | Medium | General-purpose code generation |
| `claude-opus-4-20250514` | Slow | Highest | High | Complex refactoring, architecture |
| `gpt-4o` | Fast | High | Medium | Alternative to Claude Sonnet |
| `gpt-4o-mini` | Fastest | Good | Low | Simple tasks, tests, reviews |

Override per-task via the `config.model` and `config.provider` fields in the task request.

### Retry Configuration

`MAX_AGENT_RETRIES` controls how many times a failed agent is re-run with error context appended:

| Value | Behavior | Cost Impact |
|---|---|---|
| `0` | No retries — fail immediately | Lowest |
| `1` | One retry attempt | Low |
| `3` (default) | Three retry attempts with exponential backoff | Medium |
| `5` | Five retries — aggressive self-healing | Highest |

Each retry doubles the backoff delay: 1s, 2s, 4s, 8s, 16s.

### Egress Domain Allowlist

The `ALLOWED_EGRESS_DOMAINS` variable is a comma-separated list. Subdomain matching is automatic (e.g., `github.com` also allows `api.github.com`).

To add a custom API:

```jsonc
"ALLOWED_EGRESS_DOMAINS": "api.anthropic.com,api.openai.com,api.github.com,registry.npmjs.org,api.your-service.com"
```

Then ensure the gateway has credentials for it by adding to the `credentials` map in `src/index.ts`.

### Observability Sampling

For high-traffic deployments, reduce the log sampling rate:

```jsonc
"observability": {
  "enabled": true,
  "head_sampling_rate": 0.1  // Capture 10% of requests
}
```

Note: Tail Worker logs (agent output) are always captured regardless of this setting — the sampling rate only affects the orchestrator Worker's own `console.log` calls.

---

## Multi-Environment Setup

Add environment-specific overrides to `wrangler.jsonc`:

```jsonc
{
  "env": {
    "staging": {
      "name": "agent-orchestrator-staging",
      "vars": {
        "DEFAULT_LLM_MODEL": "gpt-4o-mini",
        "MAX_AGENT_RETRIES": "1"
      },
      "kv_namespaces": [
        { "binding": "AGENT_MEMORY", "id": "<staging-kv-id>" },
        { "binding": "REPO_CREDENTIALS", "id": "<staging-kv-id>" }
      ]
    },
    "production": {
      "name": "agent-orchestrator",
      "vars": {
        "DEFAULT_LLM_MODEL": "claude-sonnet-4-20250514",
        "MAX_AGENT_RETRIES": "3"
      }
    }
  }
}
```

Deploy to a specific environment:

```bash
wrangler deploy --env staging
wrangler deploy --env production
```

Set environment-specific secrets:

```bash
wrangler secret put ANTHROPIC_API_KEY --env staging
wrangler secret put ANTHROPIC_API_KEY --env production
```
