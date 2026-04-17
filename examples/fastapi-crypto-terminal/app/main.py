"""FastAPI Crypto Price Terminal — powered by Dynamic Workers.

A live crypto price dashboard that uses the Dynamic Workers Agent
Orchestrator to run AI-powered market analysis in sandboxed V8 isolates.
"""

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .models import AnalysisRequest
from .orchestrator import OrchestratorClient
from .prices import price_service

BASE_DIR = Path(__file__).resolve().parent


# ---------------------------------------------------------------------------
# Lifespan — start/stop background price polling
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    task = asyncio.create_task(price_service.start())
    app.state.price_task = task
    app.state.orchestrator = OrchestratorClient()
    print(f"[terminal] Price streaming started (interval={settings.price_interval}s)")
    print(f"[terminal] Orchestrator: {settings.orchestrator_url}")
    yield
    # Shutdown
    price_service.stop()
    task.cancel()
    await app.state.orchestrator.close()
    await price_service.close()


app = FastAPI(
    title="Crypto Price Terminal",
    description="Live crypto prices with AI analysis via Dynamic Workers",
    version="0.1.0",
    lifespan=lifespan,
)

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def index():
    """Serve the terminal UI."""
    html_path = BASE_DIR / "templates" / "terminal.html"
    return HTMLResponse(html_path.read_text())


@app.get("/api/health")
async def health():
    """Health check — also pings the orchestrator."""
    orch_status = "unknown"
    try:
        orch = await app.state.orchestrator.health()
        orch_status = orch.get("status", "unknown")
    except Exception:
        orch_status = "unreachable"

    return {
        "service": "crypto-terminal",
        "status": "healthy",
        "orchestrator": orch_status,
        "tracked_coins": settings.tracked_coins.split(","),
    }


@app.get("/api/prices")
async def get_prices():
    """Return the latest price snapshot."""
    tick = price_service.latest
    if not tick:
        raise HTTPException(503, "Prices not yet available — try again shortly")
    return tick.model_dump()


@app.post("/api/analyze")
async def analyze_coin(req: AnalysisRequest):
    """Submit a coin for AI analysis via the Dynamic Workers orchestrator.

    The orchestrator will:
    1. Decompose the task into subtasks (codegen -> test -> review)
    2. Provision a sandboxed Dynamic Worker for each agent
    3. Inject LLM credentials via capability bindings
    4. Execute agents in isolated V8 isolates
    5. Aggregate results and return a summary
    """
    coin = price_service.latest_coin(req.coin_id)
    if not coin:
        raise HTTPException(404, f"Coin '{req.coin_id}' not found in tracked list")

    price_data = {
        "price_usd": coin.price_usd,
        "change_24h": coin.change_24h,
        "market_cap": coin.market_cap,
        "volume_24h": coin.volume_24h,
    }

    orchestrator: OrchestratorClient = app.state.orchestrator
    task_id = await orchestrator.create_analysis_task(
        coin_id=req.coin_id,
        price_data=price_data,
        analysis_type=req.analysis_type,
    )

    return {"task_id": task_id, "status": "submitted"}


@app.get("/api/tasks/{task_id}")
async def get_task(task_id: str):
    """Poll the orchestrator for task status."""
    orchestrator: OrchestratorClient = app.state.orchestrator
    status = await orchestrator.get_task(task_id)
    return status.model_dump()


@app.get("/api/usage")
async def get_usage():
    """Proxy orchestrator usage/cost stats."""
    orchestrator: OrchestratorClient = app.state.orchestrator
    return await orchestrator.get_usage()


# ---------------------------------------------------------------------------
# WebSocket — live price stream to the terminal UI
# ---------------------------------------------------------------------------

@app.websocket("/ws/prices")
async def ws_prices(ws: WebSocket):
    """Stream live price ticks to connected terminal clients."""
    await ws.accept()
    queue = price_service.subscribe()

    try:
        # Send the latest snapshot immediately on connect
        if price_service.latest:
            await ws.send_text(price_service.latest.model_dump_json())

        while True:
            tick = await queue.get()
            await ws.send_text(tick.model_dump_json())
    except WebSocketDisconnect:
        pass
    finally:
        price_service.unsubscribe(queue)
