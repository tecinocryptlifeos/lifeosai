from __future__ import annotations

from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, field_validator

class InstrumentOut(BaseModel):
    id: str | int | None = None
    symbol: str
    display_name: str
    asset_class: str
    pip_size: float = Field(gt=0)
    price_decimals: int = Field(ge=0, le=12)
    contract_size: float = Field(gt=0)

class BarOut(BaseModel):
    t: datetime
    open: float
    high: float
    low: float
    close: float

class BarsResponse(BaseModel):
    instrument: InstrumentOut
    timeframe: str
    bars: list[BarOut]
    last_bar_is_forming: bool
    server_time: datetime

class PlanRequest(BaseModel):
    symbol: str = Field(min_length=2, max_length=20)
    timeframe: Literal["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"]
    direction: Literal["buy", "sell"]
    entry: float = Field(gt=0)
    stop: float = Field(gt=0)
    target: float | None = Field(default=None, gt=0)

    @field_validator("entry", "stop", "target")
    @classmethod
    def finite_prices(cls, value):
        if value is not None and (value != value or value in (float("inf"), float("-inf"))):
            raise ValueError("price must be finite")
        return value

class PlanResponse(BaseModel):
    allowed: bool
    reason: str
    vetoes: list[str] = []
    warnings: list[str] = []
    session: str
    direction: str
    symbol: str
    entry: float
    stop: float
    target: float | None = None
    equity: float
    quantity: float = 0
    risk_amount: float = 0
    risk_fraction: float = 0
    stop_distance: float = 0
    stop_distance_pips: float | None = None
    risk_reward: float | None = None
    potential_profit: float | None = None
    costs_estimated: bool = True
    planning_only: bool = True
