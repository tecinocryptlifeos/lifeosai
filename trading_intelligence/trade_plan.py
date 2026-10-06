"""Pre-trade planning for the LifeOS trade setup builder.

Builds on ``risk.position_size`` and ``risk.portfolio_gate`` without changing
them. Adds what a trader needs before placing an order: direction and
price-ordering checks, position sizing in units and lots, reward-to-risk,
warnings, a 0-100 setup quality score and a daily loss limit check.

Conventions:
- The database uses ``buy`` / ``sell``; the model package uses ``long`` /
  ``short``. Use ``side_from_direction`` and ``direction_from_side`` to convert.
- All money amounts are in the account currency. ``quote_to_account`` converts
  one unit of the instrument's quote currency into account currency (1.0 when
  they are the same, for example EURUSD in a USD account; about 1/150 for
  USDJPY in a USD account when USDJPY trades near 150).
- Risk is a fraction of equity (0.01 means 1%).
- ``RiskPolicy.max_position_fraction`` defaults to 1.0, which means the
  position's notional value cannot exceed equity (no leverage). Leveraged
  instruments such as forex need a higher value, or sizing will be capped and
  the plan will carry a warning saying so.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, replace
from typing import Literal, Mapping

from .model import RiskPolicy, Side
from .risk import portfolio_gate, position_size

Direction = Literal["buy", "sell"]

WARN_RISK_FRACTION = 0.02
MIN_RECOMMENDED_RISK_REWARD = 1.5
TIGHT_STOP_ATR_MULTIPLE = 0.5
WIDE_STOP_ATR_MULTIPLE = 3.0
RISK_SHORTFALL_RATIO = 0.9

_DIRECTION_TO_SIDE: Mapping[str, Side] = {"buy": "long", "sell": "short"}
_SIDE_TO_DIRECTION: Mapping[str, Direction] = {"long": "buy", "short": "sell"}


def side_from_direction(direction: str) -> Side:
    try:
        return _DIRECTION_TO_SIDE[direction]
    except KeyError:
        raise ValueError(f"direction must be 'buy' or 'sell', got {direction!r}") from None


def direction_from_side(side: str) -> Direction:
    try:
        return _SIDE_TO_DIRECTION[side]
    except KeyError:
        raise ValueError(f"side must be 'long' or 'short', got {side!r}") from None


@dataclass(frozen=True)
class PortfolioState:
    """Existing positions, before the proposed trade is added."""

    open_exposure: float = 0.0  # notional of open positions
    drawdown: float = 0.0  # current drawdown as a fraction of peak equity
    correlated_exposure: float = 0.0  # notional of open positions correlated with the new trade


@dataclass(frozen=True)
class SetupPlan:
    allowed: bool
    reason: str
    direction: str
    entry: float
    stop: float
    target: float | None
    risk_fraction: float = 0.0
    risk_amount: float = 0.0
    quantity: float = 0.0
    lots: float | None = None
    notional: float = 0.0
    stop_distance: float = 0.0
    stop_distance_pips: float | None = None
    risk_reward: float | None = None
    potential_profit: float | None = None
    warnings: tuple[str, ...] = ()


def _positive(value: float | None) -> bool:
    return value is not None and math.isfinite(value) and value > 0


def _round_down_to_step(value: float, step: float) -> float:
    """Round down so the resulting risk never exceeds the budget."""
    return round(math.floor(value / step + 1e-9) * step, 10)


def plan_setup(
    *,
    direction: str,
    entry: float,
    stop: float,
    equity: float,
    policy: RiskPolicy,
    target: float | None = None,
    risk_fraction: float | None = None,
    pip_size: float | None = None,
    contract_size: float | None = None,
    quantity_step: float | None = None,
    quote_to_account: float = 1.0,
    atr: float | None = None,
    portfolio: PortfolioState | None = None,
    is_correlated: bool = False,
) -> SetupPlan:
    """Size a trade and check it against the risk policy.

    Raises ``ValueError`` for an unknown direction. Every other problem with the
    inputs or the trade comes back as a plan with ``allowed=False`` and a reason.
    """
    side_from_direction(direction)  # validates the direction

    def rejected(reason: str, **extra: object) -> SetupPlan:
        return SetupPlan(False, reason, direction, entry, stop, target, **extra)  # type: ignore[arg-type]

    if not (_positive(entry) and _positive(stop) and (target is None or _positive(target))):
        return rejected("entry, stop and target must be positive, finite prices")
    if not _positive(equity):
        return rejected("equity must be positive")
    if not _positive(quote_to_account):
        return rejected("quote_to_account must be positive")
    for name, value in (("pip_size", pip_size), ("contract_size", contract_size), ("quantity_step", quantity_step)):
        if value is not None and not _positive(value):
            return rejected(f"{name} must be positive")

    if direction == "buy":
        if stop >= entry:
            return rejected("stop must be below entry for a buy")
        if target is not None and target <= entry:
            return rejected("target must be above entry for a buy")
    else:
        if stop <= entry:
            return rejected("stop must be above entry for a sell")
        if target is not None and target >= entry:
            return rejected("target must be below entry for a sell")

    requested = policy.max_risk_fraction if risk_fraction is None else risk_fraction
    if not math.isfinite(requested) or requested <= 0:
        return rejected("risk fraction must be positive")
    if requested > policy.max_risk_fraction * (1 + 1e-9):
        return rejected(
            f"requested risk {requested:.2%} exceeds the per-trade limit of {policy.max_risk_fraction:.2%}"
        )

    # Convert prices into account currency so risk and exposure caps work in one currency.
    decision = position_size(
        equity,
        entry * quote_to_account,
        stop * quote_to_account,
        replace(policy, max_risk_fraction=requested),
    )
    if not decision.allowed:
        return rejected(decision.reason)

    quantity = decision.quantity
    if quantity_step is not None:
        quantity = _round_down_to_step(quantity, quantity_step)
        if quantity <= 0:
            return rejected("risk budget is below the minimum position size")

    stop_distance = abs(entry - stop)
    risk_amount = quantity * stop_distance * quote_to_account
    notional = quantity * entry * quote_to_account
    reward_distance = None if target is None else abs(target - entry)
    risk_reward = None if reward_distance is None else reward_distance / stop_distance
    potential_profit = (
        None if reward_distance is None else quantity * reward_distance * quote_to_account
    )

    warnings: list[str] = []
    if requested > WARN_RISK_FRACTION:
        warnings.append(f"risk per trade is above {WARN_RISK_FRACTION:.0%} of equity")
    if risk_amount < equity * requested * RISK_SHORTFALL_RATIO:
        warnings.append(
            "position is smaller than the requested risk allows (exposure cap or minimum size step)"
        )
    if target is None:
        warnings.append("no take-profit is set")
    elif risk_reward is not None and risk_reward < MIN_RECOMMENDED_RISK_REWARD:
        warnings.append(f"reward-to-risk is below {MIN_RECOMMENDED_RISK_REWARD:g}:1")
    if _positive(atr):
        if stop_distance < TIGHT_STOP_ATR_MULTIPLE * atr:  # type: ignore[operator]
            warnings.append("stop is tight relative to ATR and may be hit by normal price noise")
        elif stop_distance > WIDE_STOP_ATR_MULTIPLE * atr:  # type: ignore[operator]
            warnings.append("stop is very wide relative to ATR")

    allowed, reason = True, "risk budget satisfied"
    if portfolio is not None:
        ok, gate_reason = portfolio_gate(
            equity,
            portfolio.open_exposure + notional,
            portfolio.drawdown,
            portfolio.correlated_exposure + (notional if is_correlated else 0.0),
            policy,
        )
        if not ok:
            allowed, reason = False, gate_reason
        else:
            reason = gate_reason

    return SetupPlan(
        allowed=allowed,
        reason=reason,
        direction=direction,
        entry=entry,
        stop=stop,
        target=target,
        risk_fraction=requested,
        risk_amount=risk_amount,
        quantity=quantity,
        lots=None if contract_size is None else quantity / contract_size,
        notional=notional,
        stop_distance=stop_distance,
        stop_distance_pips=None if pip_size is None else stop_distance / pip_size,
        risk_reward=risk_reward,
        potential_profit=potential_profit,
        warnings=tuple(warnings),
    )


# --- Setup quality score -----------------------------------------------------

SCORE_COMPONENT_MAX = 20.0
SCORE_COMPONENTS = ("trend", "structure", "momentum", "entry", "risk_reward")


@dataclass(frozen=True)
class SetupScore:
    total: int  # 0-100, suitable for trading_setups.quality_score
    breakdown: dict[str, float]  # suitable for trading_setups.quality_breakdown


def risk_reward_points(risk_reward: float | None) -> float:
    """0 points at 1:1 or worse, rising linearly to the full 20 at 3:1."""
    if risk_reward is None or not math.isfinite(risk_reward):
        return 0.0
    return round(min(max(risk_reward - 1.0, 0.0) / 2.0, 1.0) * SCORE_COMPONENT_MAX, 1)


def score_setup(
    *,
    trend: float,
    structure: float,
    momentum: float,
    entry: float,
    risk_reward: float | None,
) -> SetupScore:
    """Combine five components, each worth up to 20 points, into a 0-100 score.

    ``trend``, ``structure``, ``momentum`` and ``entry`` are points from 0 to 20
    produced by the analysis layer; ``risk_reward`` is converted to points here.
    """
    parts = {"trend": trend, "structure": structure, "momentum": momentum, "entry": entry}
    for name, points in parts.items():
        if not math.isfinite(points) or not 0.0 <= points <= SCORE_COMPONENT_MAX:
            raise ValueError(f"{name} must be between 0 and {SCORE_COMPONENT_MAX:g} points")
    parts["risk_reward"] = risk_reward_points(risk_reward)
    breakdown = {name: round(parts[name], 1) for name in SCORE_COMPONENTS}
    return SetupScore(total=int(math.floor(sum(parts.values()) + 0.5)), breakdown=breakdown)


# --- Daily loss limit --------------------------------------------------------


@dataclass(frozen=True)
class DailyLossStatus:
    state: Literal["ok", "warning", "breached"]
    loss_fraction: float
    message: str


def daily_loss_status(
    *,
    day_start_equity: float,
    realized_pnl_today: float,
    max_daily_loss_fraction: float,
    warn_at_fraction_of_limit: float = 0.8,
) -> DailyLossStatus:
    """Compare today's realised loss with the daily limit (0.03 means 3% of equity)."""
    if not _positive(day_start_equity):
        raise ValueError("day_start_equity must be positive")
    if not 0 < max_daily_loss_fraction <= 1:
        raise ValueError("max_daily_loss_fraction must be between 0 and 1")
    if not 0 < warn_at_fraction_of_limit <= 1:
        raise ValueError("warn_at_fraction_of_limit must be between 0 and 1")

    loss_fraction = max(0.0, -realized_pnl_today) / day_start_equity
    if loss_fraction >= max_daily_loss_fraction:
        return DailyLossStatus("breached", loss_fraction, "daily loss limit reached: stop trading for today")
    if loss_fraction >= warn_at_fraction_of_limit * max_daily_loss_fraction:
        return DailyLossStatus("warning", loss_fraction, "approaching the daily loss limit")
    return DailyLossStatus("ok", loss_fraction, "within the daily loss limit")