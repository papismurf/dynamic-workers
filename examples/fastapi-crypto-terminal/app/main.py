"""FastAPI Crypto Price Terminal — powered by Dynamic Workers.

A live crypto price dashboard that uses the Dynamic Workers Agent
Orchestrator to run AI-powered market analysis in sandboxed V8 isolates.
"""

import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager
from contextvars import ContextVar
from pathlib import Path

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .models import AnalysisRequest
from .orchestrator import OrchestratorClient
from .prices import price_service

BASE_DIR = Path(__file__).resolve().parent

# ---------------------------------------------------------------------------
# Logging — configured once at app import time
# ---------------------------------------------------------------------------

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")


class _RequestIdFilter(logging.Filter):
    """Injects the current request_id from ContextVar into every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s [rid=%(request_id)s] %(message)s",
    force=True,
)
for _handler in logging.getLogger().handlers:
    _handler.addFilter(_RequestIdFilter())

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan — start/stop background price polling
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(price_service.start())
    app.state.price_task = task
    app.state.orchestrator = OrchestratorClient()
    logger.info("[terminal] Price streaming started (interval=%ss)", settings.price_interval)
    logger.info("[terminal] Orchestrator: %s", settings.orchestrator_url)
    logger.info("[terminal] Log level: %s", settings.log_level.upper())
    yield
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
# Request-ID middleware — access logs + X-Request-ID propagation
# ---------------------------------------------------------------------------

@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex
    token = request_id_var.set(rid)
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (time.perf_counter() - start) * 1000
        logger.exception(
            "%s %s -> 500 (%.1fms)", request.method, request.url.path, duration_ms,
        )
        request_id_var.reset(token)
        raise
    duration_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Request-ID"] = rid
    logger.info(
        "%s %s -> %d (%.1fms)",
        request.method, request.url.path, response.status_code, duration_ms,
    )
    request_id_var.reset(token)
    return response


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
    except Exception as exc:
        logger.warning("[terminal] Orchestrator health probe failed: %s", exc)
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
    """Submit a coin for AI analysis via the Dynamic Workers orchestrator."""
    coin = price_service.latest_coin(req.coin_id)
    if not coin:
        raise HTTPException(404, f"Coin '{req.coin_id}' not found in tracked list")

    price_data = {
        "price_usd": coin.price_usd,
        "change_24h": coin.change_24h,
        "market_cap": coin.market_cap,
        "volume_24h": coin.volume_24h,
    }
    logger.info(
        "[terminal] analyze request coin=%s type=%s price=%.2f change_24h=%.4f",
        req.coin_id, req.analysis_type, coin.price_usd, coin.change_24h or 0.0,
    )

    orchestrator: OrchestratorClient = app.state.orchestrator
    rid = request_id_var.get()
    try:
        task_id = await orchestrator.create_analysis_task(
            coin_id=req.coin_id,
            price_data=price_data,
            analysis_type=req.analysis_type,
            request_id=rid,
        )
    except httpx.HTTPStatusError as exc:
        logger.error(
            "[terminal] orchestrator rejected analyze: status=%s body=%s",
            exc.response.status_code, exc.response.text[:500],
        )
        return JSONResponse(
            status_code=502,
            content={
                "error": "orchestrator_rejected",
                "status": exc.response.status_code,
                "message": exc.response.text,
            },
        )
    except httpx.RequestError as exc:
        logger.error("[terminal] orchestrator unreachable: %s", exc)
        return JSONResponse(
            status_code=502,
            content={"error": "orchestrator_unreachable", "message": str(exc)},
        )

    logger.info("[terminal] analyze submitted task_id=%s", task_id)
    return {"task_id": task_id, "status": "submitted"}


@app.get("/api/tasks/{task_id}")
async def get_task(task_id: str):
    """Poll the orchestrator for task status."""
    orchestrator: OrchestratorClient = app.state.orchestrator
    rid = request_id_var.get()
    status = await orchestrator.get_task(task_id, request_id=rid)
    if status.status == "failed":
        logger.warning(
            "[terminal] task failed task_id=%s error=%s subtask_errors=%d",
            task_id, status.error, len(status.subtask_errors or []),
        )
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
        if price_service.latest:
            await ws.send_text(price_service.latest.model_dump_json())

        while True:
            tick = await queue.get()
            await ws.send_text(tick.model_dump_json())
    except WebSocketDisconnect:
        pass
    finally:
        price_service.unsubscribe(queue)
