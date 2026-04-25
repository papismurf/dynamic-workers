"""Live crypto price fetcher using the CoinGecko free API.

Prices are fetched on a configurable interval and broadcast to all
connected WebSocket clients via an in-memory pub/sub.
"""

import asyncio
import logging
import time
from collections.abc import AsyncGenerator

import httpx

from .config import settings
from .models import CoinPrice, PriceTick

logger = logging.getLogger(__name__)


class PriceService:
    """Fetches crypto prices and manages subscriber broadcast."""

    def __init__(self):
        self._http = httpx.AsyncClient(timeout=15.0)
        self._subscribers: list[asyncio.Queue[PriceTick]] = []
        self._latest: PriceTick | None = None
        self._running = False

    @property
    def latest(self) -> PriceTick | None:
        return self._latest

    def latest_coin(self, coin_id: str) -> CoinPrice | None:
        if not self._latest:
            return None
        for coin in self._latest.coins:
            if coin.id == coin_id:
                return coin
        return None

    async def fetch_prices(self) -> list[CoinPrice]:
        """Fetch current prices from CoinGecko."""
        coins = settings.tracked_coins
        url = (
            f"{settings.coingecko_base_url}/coins/markets"
            f"?vs_currency=usd&ids={coins}"
            f"&order=market_cap_desc&sparkline=false"
            f"&price_change_percentage=24h"
        )
        resp = await self._http.get(url)
        resp.raise_for_status()
        data = resp.json()

        return [
            CoinPrice(
                id=c["id"],
                symbol=c["symbol"].upper(),
                name=c["name"],
                price_usd=c["current_price"] or 0,
                change_24h=c.get("price_change_percentage_24h"),
                market_cap=c.get("market_cap"),
                volume_24h=c.get("total_volume"),
                last_updated=c.get("last_updated"),
            )
            for c in data
        ]

    async def start(self):
        """Start the background price polling loop."""
        self._running = True
        while self._running:
            try:
                coins = await self.fetch_prices()
                tick = PriceTick(coins=coins, timestamp=time.time())
                self._latest = tick
                for q in list(self._subscribers):
                    try:
                        q.put_nowait(tick)
                    except asyncio.QueueFull:
                        pass  # slow consumer — drop tick
            except httpx.HTTPStatusError as exc:
                logger.warning("[prices] CoinGecko API error: %s", exc.response.status_code)
            except Exception as exc:
                logger.error("[prices] Fetch error: %s", exc, exc_info=True)

            await asyncio.sleep(settings.price_interval)

    def stop(self):
        self._running = False

    def subscribe(self) -> asyncio.Queue[PriceTick]:
        q: asyncio.Queue[PriceTick] = asyncio.Queue(maxsize=32)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[PriceTick]):
        self._subscribers.remove(q)

    async def stream(self) -> AsyncGenerator[PriceTick, None]:
        """Async generator that yields price ticks as they arrive."""
        q = self.subscribe()
        try:
            while True:
                tick = await q.get()
                yield tick
        finally:
            self.unsubscribe(q)

    async def close(self):
        self.stop()
        await self._http.aclose()


# Singleton shared across the app
price_service = PriceService()
