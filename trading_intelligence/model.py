from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Mapping

Side = Literal["long", "short"]
AssetClass = Literal["forex", "equity", "index", "crypto"]

@dataclass(frozen=True)
class Bar:
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float | None = None

    def __post_init__(self) -> None:
        if self.high < max(self.open, self.close) or self.low > min(self.open, self.close):
            raise ValueError("OHLC invariant violated")
        if self.low > self.high:
            raise ValueError("low must not exceed high")

@dataclass(frozen=True)
class Pivot:
    index: int
    timestamp: datetime
    price: float
    kind: Literal["high", "low"]
    confirmation_index: int

    @property
    def causal(self) -> bool:
        return self.confirmation_index >= self.index

@dataclass(frozen=True)
class StructureState:
    regime: Literal["uptrend", "downtrend", "range", "undetermined"]
    last_confirmed_high: Pivot | None = None
    last_confirmed_low: Pivot | None = None
    events: tuple[str, ...] = ()

@dataclass(frozen=True)
class StrategyDefinition:
    strategy_id: str
    version: int
    name: str
    asset_classes: tuple[AssetClass, ...]
    entry_rules: tuple[str, ...]
    exit_rules: tuple[str, ...]
    causal_inputs: tuple[str, ...]
    parameters: Mapping[str, float | int | str]
    invalidation_rules: tuple[str, ...] = ()

@dataclass(frozen=True)
class RiskPolicy:
    max_risk_fraction: float = 0.01
    max_position_fraction: float = 1.0
    max_portfolio_exposure_fraction: float = 1.0
    max_drawdown_fraction: float = 0.20
    max_correlated_exposure_fraction: float = 0.50
    min_stop_distance: float = 1e-12

@dataclass(frozen=True)
class ExperimentSpec:
    experiment_id: str
    strategy_id: str
    symbol: str
    asset_class: AssetClass
    timeframe: str
    start: datetime
    end: datetime
    development_end: datetime
    evaluation_end: datetime
    costs: Mapping[str, float] = field(default_factory=dict)
    parameters: Mapping[str, float | int | str] = field(default_factory=dict)
    seed: int = 0
