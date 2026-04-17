# Crypto Price Terminal

A live cryptocurrency price terminal built with **FastAPI** that uses the [Dynamic Workers Agent Orchestrator](../../README.md) for AI-powered market analysis.

Prices stream in real time via WebSocket. Click **analyze** on any coin to submit an analysis task to the orchestrator — it provisions sandboxed Dynamic Workers, runs AI agents in isolated V8 isolates, and streams the results back to your terminal.

```
Browser ←──WebSocket──→ FastAPI ←──REST──→ Orchestrator ←──Dynamic Workers──→ AI Agents
              ↑                                                                    ↓
         live prices                                              sandboxed V8 isolates
       (CoinGecko API)                                          (LLM bindings injected)
```

## Quick Start

```bash
# 1. Start the orchestrator (from the repo root)
npm run dev
# → http://localhost:8787

# 2. Set up the terminal (from this directory)
cp .env.example .env
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# → http://localhost:8000
```

Open `http://localhost:8000` in your browser.

## With Docker

```bash
cp .env.example .env
docker compose up --build
```

## How It Works

1. **Price streaming** — The FastAPI backend polls CoinGecko every 10s and pushes price ticks to all connected browsers via WebSocket.

2. **AI analysis** — When you click "analyze" on a coin, the terminal:
   - Sends a `POST /api/analyze` request to FastAPI
   - FastAPI submits a task to the orchestrator via `POST /tasks`
   - The orchestrator decomposes it into subtasks (codegen → test → review)
   - Each subtask runs in a sandboxed Dynamic Worker with LLM bindings
   - FastAPI polls for results and displays the analysis in the terminal log

3. **Orchestrator integration** — The `OrchestratorClient` in `app/orchestrator.py` wraps the orchestrator's REST API. It generates agent source code (JavaScript) that runs inside the Dynamic Worker sandbox, using the `env.LLM` binding for AI inference — credentials never touch the agent.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Terminal web UI |
| `GET` | `/api/health` | Health check (includes orchestrator status) |
| `GET` | `/api/prices` | Latest price snapshot |
| `POST` | `/api/analyze` | Submit coin for AI analysis |
| `GET` | `/api/tasks/:id` | Poll analysis task status |
| `GET` | `/api/usage` | Orchestrator cost stats |
| `WS` | `/ws/prices` | Live price stream |

## Configuration

All settings are configurable via environment variables or `.env`:

| Variable | Default | Description |
|---|---|---|
| `ORCHESTRATOR_URL` | `http://localhost:8787` | Dynamic Workers orchestrator URL |
| `TRACKED_COINS` | `bitcoin,ethereum,...` | CoinGecko coin IDs to track |
| `PRICE_INTERVAL` | `10.0` | Seconds between price fetches |
| `GITHUB_OWNER` | `myorg` | GitHub owner for orchestrator tasks |
| `GITHUB_REPO` | `crypto-terminal` | GitHub repo for orchestrator tasks |
