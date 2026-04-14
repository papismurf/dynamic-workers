# Docker & Docker Compose

This project ships with a multi-stage `Dockerfile` and two Compose overrides
— one for development, one for deploying to Cloudflare. Use Docker when you
want a reproducible toolchain (pinned Node + wrangler versions), don't want
to install Node on the host, or are wiring the deploy step into CI.

## What the production image is (and isn't)

Cloudflare Workers run on Cloudflare's global edge network. The production
image in this repo **does not host the Worker** — it is a pinned deploy
toolchain that runs `wrangler deploy` and pushes the Worker to Cloudflare.
Treat "production Docker" here like a CI builder, not a runtime server.

If you want a long-running local HTTP endpoint, use the **development**
compose file — it runs `wrangler dev`, which serves the Worker on
`http://localhost:8787` backed by the local `workerd` runtime.

---

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage build: `base` → `deps` → `dev` / `typecheck` / `prod` |
| `.dockerignore` | Keeps secrets, `node_modules`, and `.wrangler` out of the build context |
| `docker-compose.yml` | Shared service definition (image, build context, persistent wrangler state) |
| `docker-compose.dev.yml` | Dev override — `wrangler dev` + source bind-mount + port 8787 |
| `docker-compose.prod.yml` | Prod override — `wrangler deploy` as a one-shot run |
| `.env.example` | Template for `.dev.vars` (dev) and `.env` (deploy credentials) |

---

## Development workflow

### 1. Create `.dev.vars`

`wrangler dev` reads Worker secrets from `.dev.vars` (not `.env`). Start
from the template:

```bash
cp .env.example .dev.vars
# edit .dev.vars and fill in ANTHROPIC_API_KEY / OPENAI_API_KEY / GITHUB_PAT
```

`.dev.vars` is gitignored and mounted read-only into the container.

### 2. Start the dev server

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

The Worker is now reachable at `http://localhost:8787`. Smoke-test it:

```bash
curl http://localhost:8787/health
```

**Hot reload**: the `src/` directory is bind-mounted, so saving a file on
the host triggers wrangler's watcher inside the container. No rebuild
required.

**node_modules**: stored in a named volume (`node_modules`) so host-built
platform binaries (esbuild, etc.) don't conflict with the Linux-built
versions inside the container.

### 3. Useful dev commands

```bash
# One-off commands inside the dev container
docker compose -f docker-compose.yml -f docker-compose.dev.yml \
  run --rm orchestrator npm run typecheck

docker compose -f docker-compose.yml -f docker-compose.dev.yml \
  run --rm orchestrator npx wrangler kv namespace list

# Stop and remove containers (keeps volumes)
docker compose -f docker-compose.yml -f docker-compose.dev.yml down

# Full reset (drops node_modules + wrangler state volumes)
docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v
```

---

## Production deploy workflow

### 1. Create `.env` with deploy credentials

```bash
cp .env.example .env
# fill in CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID if your token
# is scoped to multiple accounts)
```

Generate the API token at
<https://dash.cloudflare.com/profile/api-tokens> using the **Edit
Cloudflare Workers** template.

### 2. Set Worker secrets once (not through Docker)

Worker runtime secrets (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GITHUB_PAT`)
are stored on Cloudflare, not baked into the image. Set them once per
environment:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  run --rm orchestrator npx wrangler secret put ANTHROPIC_API_KEY
# repeat for OPENAI_API_KEY, GITHUB_PAT
```

### 3. Deploy

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  run --rm orchestrator
```

The `prod` stage depends on the `typecheck` stage, so a TypeScript error
fails the build *before* `wrangler deploy` runs. A broken tree can't be
pushed to production.

### 4. Tail production logs

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  run --rm orchestrator npx wrangler tail
```

---

## CI/CD integration

The production compose file is designed to be called from CI. A minimal
GitHub Actions job:

```yaml
deploy:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Deploy
      env:
        CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      run: |
        docker compose -f docker-compose.yml -f docker-compose.prod.yml \
          run --rm orchestrator
```

If your CI already caches Docker layers, the `deps` stage is the big win —
it only re-runs `npm ci` when `package-lock.json` changes.

For a gate-only check (no deploy), target the typecheck stage directly:

```bash
docker build --target typecheck -t orchestrator-check .
```

---

## Image layout

```
base       alpine + node 20 + git + tini + ca-certificates
  └── deps        + node_modules (from npm ci, cached via BuildKit)
        ├── dev         + full source; runs `wrangler dev`
        ├── typecheck   + full source; runs `npm run typecheck` at build time
        └── prod        copies /app from typecheck; runs `wrangler deploy`
```

Why `tini`? Wrangler spawns child processes (workerd, esbuild). Without a
proper PID 1, `docker stop` can leave zombies and slow shutdown.

Why Alpine? Small image, fast pulls in CI. If you hit a native-module
compatibility issue (rare with this dep tree), switch the base to
`node:20-bookworm-slim`.

---

## Troubleshooting

**`wrangler dev` exits immediately with "authentication required"**
You're hitting a command that needs a real Cloudflare login. `wrangler dev`
itself runs offline by default, but commands like `wrangler kv namespace
create` require auth. Either run `wrangler login` inside the container (a
browser URL will be printed) or set `CLOUDFLARE_API_TOKEN` in the
environment.

**Port 8787 isn't reachable from the host**
Confirm wrangler is bound to `0.0.0.0`, not `127.0.0.1`. The dev compose
file passes `--ip 0.0.0.0` explicitly; if you override the command, keep
that flag.

**File changes don't trigger a reload**
On Windows/macOS, Docker Desktop's file-event propagation can be flaky on
bind mounts. Restart the container, or switch to a polling watcher by
setting `CHOKIDAR_USEPOLLING=true` in the dev override's `environment`.

**`npm ci` fails with EACCES on `node_modules`**
Delete the named volume so it rebuilds clean:
`docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v`.
