from pydantic import BaseModel


class CoinPrice(BaseModel):
    """A single coin's live price snapshot."""
    id: str
    symbol: str
    name: str
    price_usd: float
    change_24h: float | None = None
    market_cap: float | None = None
    volume_24h: float | None = None
    last_updated: str | None = None


class PriceTick(BaseModel):
    """WebSocket message pushed to the terminal UI."""
    type: str = "price_tick"
    coins: list[CoinPrice]
    timestamp: float


class AnalysisRequest(BaseModel):
    """User request for an AI-powered analysis via the orchestrator."""
    coin_id: str
    analysis_type: str = "summary"  # summary | technical | sentiment


class OrchestratorTask(BaseModel):
    """Mirrors the orchestrator's task creation response."""
    task_id: str
    status: str = "pending"


class TaskStatus(BaseModel):
    """Simplified task status from the orchestrator."""
    id: str
    status: str
    summary: str | None = None
    error: str | None = None
    cost_usd: float | None = None
