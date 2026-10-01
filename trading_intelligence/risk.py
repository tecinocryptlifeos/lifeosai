from __future__ import annotations
from dataclasses import dataclass
from .model import RiskPolicy

@dataclass(frozen=True)
class RiskDecision:
    allowed: bool
    quantity: float
    risk_amount: float
    reason: str

def position_size(equity: float, entry: float, stop: float, policy: RiskPolicy) -> RiskDecision:
    if equity <= 0: return RiskDecision(False, 0.0, 0.0, "equity must be positive")
    distance = abs(entry-stop)
    if distance < policy.min_stop_distance: return RiskDecision(False, 0.0, 0.0, "stop distance is too small")
    if not 0 < policy.max_risk_fraction <= 1: return RiskDecision(False, 0.0, 0.0, "invalid max risk fraction")
    risk_amount = equity * policy.max_risk_fraction
    quantity = min(risk_amount/distance, equity*policy.max_position_fraction/max(entry, policy.min_stop_distance))
    if quantity <= 0: return RiskDecision(False, 0.0, risk_amount, "position limit leaves no capacity")
    return RiskDecision(True, quantity, quantity*distance, "risk budget satisfied")

def portfolio_gate(equity: float, exposure: float, drawdown: float, correlated_exposure: float, policy: RiskPolicy) -> tuple[bool, str]:
    if equity <= 0: return False, "equity must be positive"
    if drawdown >= policy.max_drawdown_fraction: return False, "drawdown limit breached"
    if exposure/equity > policy.max_portfolio_exposure_fraction: return False, "portfolio exposure limit breached"
    if correlated_exposure/equity > policy.max_correlated_exposure_fraction: return False, "correlated exposure limit breached"
    return True, "risk gates satisfied"
