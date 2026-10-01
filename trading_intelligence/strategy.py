from __future__ import annotations
from dataclasses import dataclass
from .model import StrategyDefinition

@dataclass(frozen=True)
class StrategySignal:
    action: str
    reason: str
    index: int

def validate_strategy_definition(strategy: StrategyDefinition) -> None:
    if not strategy.strategy_id.strip(): raise ValueError("strategy_id is required")
    if strategy.version < 1: raise ValueError("strategy version must be >= 1")
    if not strategy.entry_rules: raise ValueError("at least one entry rule is required")
    if not strategy.exit_rules: raise ValueError("at least one exit rule is required")
    if not strategy.causal_inputs: raise ValueError("strategy must declare causal inputs")
    if any(token in item.lower() for item in strategy.causal_inputs for token in ("future", "repaint")):
        raise ValueError("future-looking or repainting inputs are forbidden")
