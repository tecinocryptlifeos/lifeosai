"""Market bars adapter. Fails closed: no fabricated bars are used in production."""
from __future__ import annotations
import os
from datetime import datetime, timezone
import httpx

MARKET_DATA_URL = os.environ.get("MARKET_DATA_URL", "").strip()
MARKET_DATA_KEY = os.environ.get("MARKET_DATA_KEY", "").strip()
TIMEFRAME_MINUTES = {"M1":1,"M5":5,"M15":15,"M30":30,"H1":60,"H4":240,"D1":1440,"W1":10080}

class MarketDataError(RuntimeError):
    pass

def _first(row, keys):
    for key in keys:
        if row.get(key) is not None:
            return row[key]
    raise MarketDataError("market data bar is missing a required OHLC/time field")

def _datetime(value):
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000 if value > 1e11 else value, tz=timezone.utc)
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

async def fetch_bars(symbol: str, timeframe: str, limit: int = 300):
    if timeframe not in TIMEFRAME_MINUTES:
        raise MarketDataError("unsupported timeframe")
    if not MARKET_DATA_URL:
        raise MarketDataError("MARKET_DATA_URL is not configured; live market data is unavailable")
    headers = {"Authorization": f"Bearer {MARKET_DATA_KEY}"} if MARKET_DATA_KEY else {}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(MARKET_DATA_URL, params={"symbol":symbol,"timeframe":timeframe,"limit":max(1,min(int(limit),1000))}, headers=headers)
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise MarketDataError(f"market data provider request failed: {type(exc).__name__}") from None
    rows = payload.get("bars", payload) if isinstance(payload, dict) else payload
    if not isinstance(rows, list) or not rows:
        raise MarketDataError("market data provider returned no bars")
    bars=[]
    for row in rows:
        if not isinstance(row, dict):
            raise MarketDataError("market data provider returned an invalid bar")
        bar={"t":_datetime(_first(row,("t","time","timestamp","ts","date","datetime","open_time"))),
             "open":float(_first(row,("open","o","openPrice"))),
             "high":float(_first(row,("high","h","highPrice"))),
             "low":float(_first(row,("low","l","lowPrice"))),
             "close":float(_first(row,("close","c","closePrice")))}
        if not all(__import__("math").isfinite(bar[k]) for k in ("open","high","low","close")):
            raise MarketDataError("market data contains non-finite prices")
        if bar["low"] > min(bar["open"],bar["close"]) or bar["high"] < max(bar["open"],bar["close"]) or bar["low"] > bar["high"]:
            raise MarketDataError("market data contains inconsistent OHLC values")
        bars.append(bar)
    bars.sort(key=lambda b:b["t"])
    # Provider bars are considered forming only when the last candle's time interval contains now.
    now=datetime.now(timezone.utc)
    forming=(bars[-1]["t"] <= now < bars[-1]["t"].replace() + __import__("datetime").timedelta(minutes=TIMEFRAME_MINUTES[timeframe]))
    return bars, forming
