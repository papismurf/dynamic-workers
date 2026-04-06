# Security Model

The Agent Orchestrator runs untrusted LLM-generated code inside Cloudflare Dynamic Workers. Security is achieved through multiple layers: network isolation, capability-based bindings, credential separation, and resource limits.

---

## 1. Network Isolation (Egress Control)

Every agent Dynamic Worker has its `globalOutbound` set to the `HttpGateway` WorkerEntrypoint. This means **every** `fetch()` and `connect()` call from the agent is intercepted before it reaches the network.

### Domain Allowlist

The gateway maintains an explicit list of permitted domains. Only these can be contacted:

| Domain | Purpose |
|---|---|
| `api.github.com` | File reads, commits, PRs |
| `api.anthropic.com` | Claude LLM API |
| `api.openai.com` | GPT LLM API |
| `registry.npmjs.org` | Package metadata (for dependency agent) |

Any request to an unlisted domain receives a `403` response:

```json
{
  "error": "egress_blocked",
  "message": "Outbound requests to evil.com are not permitted.",
  "allowedDomains": ["api.github.com", "api.anthropic.com", "api.openai.com", "registry.npmjs.org"]
}
```

The allowlist is configured via the `ALLOWED_EGRESS_DOMAINS` environment variable and can be changed without redeploying.

### Audit Trail

Every outbound request is logged with:
- Agent ID and Task ID (via `X-Agent-Id` / `X-Task-Id` headers)
- HTTP method, hostname, and path
- Whether the request was allowed or blocked

These logs are captured by the Tail Worker and persisted to Workers Logs.

---

## 2. Capability-Based Sandboxing

The system uses Cloudflare's **Cap'n Web** RPC model for capability-based security:

- Agents only receive the **specific bindings** they are given via `env`.
- There is no global registry, no service discovery. If an agent doesn't receive a binding, it **cannot access** that resource.
- Each binding is **specialized** for the specific agent via `ctx.props` — a FileSystem binding for agent A points at repo A, and cannot be used to access repo B.

### Principle of Least Privilege

| Agent Type | FS (read) | FS (write) | Git | LLM | Search | Memory |
|---|---|---|---|---|---|---|
| CodeGen | Yes | Yes | Yes | Yes | Yes | Yes |
| Test | Yes | Yes | Yes | Yes | Yes | Yes |
| Review | Yes | No | Read-only | Yes | Yes | Yes |

In the current implementation, all agents receive the same binding set. Future revisions could restrict write access for review agents by defining a `ReadOnlyFileSystem` entrypoint.

---

## 3. Credential Separation

Agents **never see** raw credentials. Here's how each secret is handled:

| Secret | Storage | Access Pattern |
|---|---|---|
| `GITHUB_PAT` | Wrangler secret | Injected by `HttpGateway` into outbound GitHub API requests |
| `ANTHROPIC_API_KEY` | Wrangler secret | Injected by `HttpGateway` as `x-api-key` header |
| `OPENAI_API_KEY` | Wrangler secret | Injected by `HttpGateway` as `Authorization: Bearer` header |

The `HttpGateway` receives credentials via `ctx.props.credentials` — a map of domain to credential. The gateway matches the request's hostname and injects the appropriate authentication headers.

The agent code only knows how to call `env.LLM.chat(...)` or `env.FS.read(...)`. The RPC boundary ensures the agent cannot reflect on or extract the credentials from the binding stubs.

---

## 4. Resource Limits

Standard Cloudflare Workers limits apply to each Dynamic Worker:

| Resource | Limit (Paid Plan) |
|---|---|
| CPU time per request | 30 seconds |
| Memory per isolate | 128 MB |
| Subrequests per request | 1,000 |
| Request body size | 100 MB |
| Response body size | No limit (streaming) |

The orchestrator can configure per-agent limits via the `AgentConfig`:

```typescript
{
  "config": {
    "cpuLimitMs": 10000,
    "subrequestLimit": 100
  }
}
```

---

## 5. Isolation Guarantees

Each agent runs in a **separate V8 isolate**:

- No shared memory between agents.
- No shared global state.
- No filesystem access (all file operations go through RPC to GitHub).
- No process spawning or system calls.
- Code is single-threaded within the isolate.

Even if an agent's LLM-generated code is malicious:
- It cannot access the network (blocked by `globalOutbound`).
- It cannot read secrets (credentials are in the parent Worker's scope).
- It cannot affect other agents (separate isolates).
- It cannot escape the V8 sandbox (Cloudflare's fundamental security guarantee).

---

## 6. Supply Chain Considerations

### Agent Source Code

Agent source is embedded as string constants in `src/agents/source.ts`. The orchestrator passes this source to `@cloudflare/worker-bundler` for compilation. The source is controlled by the system operator — agents cannot modify their own code.

### npm Dependencies

If agent source includes npm dependencies (via `package.json` in the bundled files), they are resolved at runtime by `@cloudflare/worker-bundler` from the public npm registry. Consider:

- Pinning dependency versions in agent source.
- Using the `minify` option to reduce attack surface from dependency injection.
- Reviewing resolved dependency trees for critical agents.

### LLM Prompt Injection

Agents receive task descriptions from user input, which is included in LLM prompts. To mitigate prompt injection:

- System prompts are separate from user content.
- Agent output is parsed as structured data (code blocks with file paths) rather than executed as instructions.
- The self-heal loop limits retries to prevent infinite loops from adversarial prompts.

---

## 7. Recommendations for Production

1. **Rotate secrets regularly** — use `wrangler secret put` to rotate GitHub PATs and API keys.
2. **Restrict GitHub PAT scope** — use fine-grained PATs with only the `contents:write` and `pull_requests:write` permissions on specific repositories.
3. **Enable Workers Logs** — already configured in `wrangler.jsonc`. Use Workers Logs to audit all agent activity.
4. **Set `MAX_AGENT_RETRIES` conservatively** — defaults to 3. Lower this in production to limit runaway cost from self-heal loops.
5. **Monitor cost** — poll `GET /usage` or integrate the `CostTracker` DO with an alerting system.
6. **Review before merge** — the human-in-the-loop review gate (`POST /tasks/:id/review`) is the last line of defense before agent code becomes a PR.
