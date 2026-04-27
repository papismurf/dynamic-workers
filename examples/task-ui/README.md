# Dynamic Workers — Task UI

A lightweight task submission and monitoring interface for the [dynamic-workers](../../README.md) AI Agent Orchestrator.

Built with **Vite + React 19 + TypeScript**, TanStack Query, and Tailwind CSS v4.

---

## Features

- Submit agent tasks with a structured form (codegen, test, review, refactor, debug, dependency)
- Real-time log streaming over WebSocket
- Live task status polling with subtask progress
- Human-in-the-loop review panel (approve / reject / request revision)
- Usage and cost tracking sidebar

---

## Setup

```bash
cd examples/task-ui
cp .env.example .env
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `VITE_ORCHESTRATOR_URL` | Base URL of the orchestrator worker | `http://localhost:8787` |

---

## Connecting to the Orchestrator

### Local development

1. Start the orchestrator with `wrangler dev` from the project root.
2. Set `VITE_ORCHESTRATOR_URL=http://localhost:8787` in `.env`.
3. Run `npm run dev` in this directory.

**CORS:** The browser will make cross-origin requests from `localhost:5173` to `localhost:8787`. You have two options:

**Option A — Add CORS headers to the Worker** (recommended):

In `src/index.ts`, add to the `fetch` handler before routing:

```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

if (request.method === 'OPTIONS') {
  return new Response(null, { status: 204, headers: corsHeaders })
}
// Attach corsHeaders to all responses...
```

**Option B — Enable the Vite proxy** (no Worker changes needed):

In `vite.config.ts`, uncomment the `proxy` block, then set `VITE_ORCHESTRATOR_URL=/api` in `.env`.

### Deployed worker

Set `VITE_ORCHESTRATOR_URL=https://agent-orchestrator.<subdomain>.workers.dev` in `.env` and run `npm run build`.

---

## Build

```bash
npm run build
# Output: dist/
```

The `dist/` folder is a static SPA deployable to any static host (Cloudflare Pages, Vercel, S3, etc.).

---

## Project Structure

```
src/
  api/
    types.ts        — Shared TypeScript types (mirrors src/types.ts from the Worker)
    client.ts       — Typed fetch wrappers for all orchestrator endpoints
  hooks/
    useTask.ts      — Polling hook for task state
    useTaskStream.ts — WebSocket hook for live log streaming
    useUsage.ts     — Polling hook for usage/cost data
  components/
    TaskForm.tsx    — Task submission form
    TaskCard.tsx    — Live task status card
    LogStream.tsx   — Terminal-style log viewer
    ReviewPanel.tsx — Human-in-the-loop approve/reject/revise panel
    UsageSidebar.tsx — Token and cost summary
  pages/
    HomePage.tsx    — Task form + recent submissions
    TaskPage.tsx    — Task detail: card + logs + review
```
