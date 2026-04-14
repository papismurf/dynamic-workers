# syntax=docker/dockerfile:1.6

# ---------- base ----------
# Shared base: pinned Node + system deps wrangler needs (git for git bindings,
# tini for PID 1 signal handling, ca-certificates for HTTPS to Cloudflare).
FROM node:20-alpine AS base
RUN apk add --no-cache git tini ca-certificates
WORKDIR /app
ENV CI=true \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# ---------- deps ----------
# Install the full dependency tree once so downstream stages can reuse the
# layer. Copying only the manifests first keeps this cache hit on code-only
# changes.
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# ---------- dev ----------
# Development image: runs `wrangler dev` with hot reload. The source tree is
# bind-mounted in docker-compose.dev.yml, so we only need the toolchain baked
# into the image itself.
FROM deps AS dev
COPY . .
EXPOSE 8787
ENTRYPOINT ["/sbin/tini", "--"]
# --ip 0.0.0.0 is required so the port is reachable from the host, not just
# the container's loopback.
CMD ["npx", "wrangler", "dev", "--ip", "0.0.0.0", "--port", "8787"]

# ---------- typecheck ----------
# Dedicated stage so CI can `docker build --target typecheck` as a gate
# without producing a runtime image.
FROM deps AS typecheck
COPY . .
RUN npm run typecheck

# ---------- prod ----------
# Production image: a reproducible deploy toolchain. Cloudflare Workers run
# on Cloudflare's edge — this image does NOT host the worker. It runs
# `wrangler deploy` (pushing to Cloudflare) and is the image used by CI and
# by docker-compose.prod.yml. Typecheck is a dependency so a failing build
# cannot be deployed.
FROM deps AS prod
COPY --from=typecheck /app /app
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "wrangler", "deploy"]
