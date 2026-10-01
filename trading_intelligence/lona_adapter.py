from __future__ import annotations
from dataclasses import dataclass
from .model import ExperimentSpec, StrategyDefinition

@dataclass(frozen=True)
class LonaBacktestRequest:
    strategy_id: str
    symbol: str
    timeframe: str
    start: str
    end: str
    parameters: dict[str, float | int | str]

def build_lona_request(spec: ExperimentSpec, strategy: StrategyDefinition) -> LonaBacktestRequest:
    if spec.strategy_id != strategy.strategy_id: raise ValueError("experiment strategy does not match strategy definition")
    if spec.start >= spec.end: raise ValueError("experiment start must precede end")
    merged = dict(strategy.parameters); merged.update(spec.parameters)
    return LonaBacktestRequest(strategy.strategy_id, spec.symbol, spec.timeframe, spec.start.isoformat(), spec.end.isoformat(), merged)
