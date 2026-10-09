"""Conservative planning calculations; no order execution or broker connectivity."""
from __future__ import annotations
from datetime import datetime, timezone
from trading_intelligence.model import RiskPolicy
from trading_intelligence.risk import position_size
from .schemas import PlanRequest, PlanResponse

def session_for(now: datetime) -> str:
    utc=now.astimezone(timezone.utc)
    if utc.weekday() >= 5: return "weekend"
    hour=utc.hour
    if 12 <= hour < 16: return "london_new_york_overlap"
    if 7 <= hour < 16: return "london"
    if 13 <= hour < 22: return "new_york"
    if 0 <= hour < 9: return "asia"
    return "off_hours"

def build_plan(req: PlanRequest, instrument: dict, profile: dict, open_trades: list[dict], closed_today: list[dict] | None = None) -> PlanResponse:
    equity=float(profile.get("account_balance") or 0)
    if equity <= 0: raise ValueError("account balance must be positive")
    entry, stop=req.entry, req.stop
    geometry_ok=(stop < entry if req.direction=="buy" else stop > entry)
    target_ok=(req.target is None or (req.target > entry if req.direction=="buy" else req.target < entry))
    vetoes=[]
    if not geometry_ok: vetoes.append("stop must be below entry for buys and above entry for sells")
    if not target_ok: vetoes.append("target must be above entry for buys and below entry for sells")
    now=datetime.now(timezone.utc)
    session=session_for(now)
    if session=="weekend" and instrument.get("asset_class")=="forex": vetoes.append("forex planning is blocked during the weekend")
    realized_or_unrealized=sum(float(x.get("pnl_amount") or 0) for x in (closed_today or [])) + sum(float(x.get("pnl_amount") or 0) for x in open_trades)
    daily_limit=float(profile.get("max_daily_loss_percent") or 3.0)/100
    if realized_or_unrealized < -(equity*daily_limit): vetoes.append("daily loss limit appears breached; verify account-day accounting")
    open_risk=sum(float(x.get("risk_amount") or 0) for x in open_trades)
    max_open_risk=min(float(profile.get("max_open_risk_percent") or 5)/100,0.04)
    if open_risk/equity >= max_open_risk: vetoes.append("maximum open risk reached")
    max_positions=min(int(profile.get("max_open_positions") or 5),4)
    if len(open_trades) >= max_positions: vetoes.append("maximum open positions reached")
    max_risk=min(float(profile.get("max_risk_per_trade_percent") or 2)/100,0.005)
    base_risk=min(float(profile.get("default_risk_percent") or 1)/100,max_risk,0.005)
    policy=RiskPolicy(max_risk_fraction=base_risk,max_position_fraction=1.0,min_stop_distance=1e-12)
    decision=position_size(equity,entry,stop,policy)
    if not decision.allowed: vetoes.append(decision.reason)
    distance=abs(entry-stop)
    quantity=decision.quantity if decision.allowed and not vetoes else 0.0
    risk_amount=decision.risk_amount if quantity > 0 else 0.0
    reward=abs(req.target-entry) if req.target is not None else None
    rr=(reward/distance) if reward is not None and distance>0 else None
    pip=float(instrument["pip_size"])
    return PlanResponse(allowed=not vetoes,reason=vetoes[0] if vetoes else "risk and geometry checks passed; technical confirmation is not included",vetoes=vetoes,warnings=["This endpoint checks risk and price geometry only; it does not generate a market signal.","Costs, slippage, and currency conversion are not included in this estimate."],session=session,direction=req.direction,symbol=req.symbol.upper(),entry=entry,stop=stop,target=req.target,equity=round(equity,2),quantity=round(quantity,8),risk_amount=round(risk_amount,2),risk_fraction=(risk_amount/equity if equity else 0),stop_distance=distance,stop_distance_pips=distance/pip,risk_reward=rr,potential_profit=(quantity*reward if reward is not None else None),costs_estimated=True,planning_only=True)
