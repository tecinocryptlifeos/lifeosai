"""Performance statistics for the LifeOS trading journal.

Pure functions over closed trades, with no I/O. The figures match the Supabase
views ``trading_performance_summary`` and ``trading_performance_by_session``.
Here every value is computed from unrounded inputs and rounded only for
presentation (win rate to 1 decimal place, everything else to 2), while the
views round each trade's R-multiple to 2 decimal places before aggregating, so
the two can differ in the last decimal place.

Definitions:
- R-multiple: net result divided by the amount risked. Trades with no recorded
  risk amount are left out of every R statistic but still count everywhere else.
- Win rate: winning trades divided by all trades. Breakeven trades count as
  neither wins nor losses.
- Profit factor: gross profit divided by gross loss. ``None`` when there are no
  losing trades, because the ratio is undefined.
- Max drawdown: largest peak-to-trough fall of cumulative net result in
  account currency, with the starting balance as the first peak.
- Losing streak: longest run of consecutive losing trades. A winning or
  breakeven trade ends a streak.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from math import isfinite
from typing import Any, Iterable, Mapping

UNSPECIFIED_SESSION = "unspecified"


@dataclass(frozen=True)
class ClosedTrade:
    """One closed journal trade. ``pnl`` is the net result after fees."""

    closed_at: datetime
    pnl: float
    risk_amount: float | None = None
    session: str | None = None

    def __post_init__(self) -> None:
        if not isfinite(self.pnl):
            raise ValueError("pnl must be a finite number")
        if self.risk_amount is not None and (
            not isfinite(self.risk_amount) or self.risk_amount < 0
        ):
            raise ValueError("risk_amount must be a non-negative, finite number")

    @property
    def r_multiple(self) -> float | None:
        if self.risk_amount is None or self.risk_amount <= 0:
            return None
        return self.pnl / self.risk_amount

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> "ClosedTrade":
        """Build from a ``trading_trades`` row as returned by Supabase."""
        if row.get("status") != "closed":
            raise ValueError("only closed trades can be analysed")
        closed_at = row.get("closed_at")
        pnl = row.get("pnl_amount")
        if closed_at is None or pnl is None:
            raise ValueError("closed trade is missing closed_at or pnl_amount")
        if isinstance(closed_at, str):
            closed_at = datetime.fromisoformat(closed_at.replace("Z", "+00:00"))
        risk = row.get("risk_amount")
        return cls(
            closed_at=closed_at,
            pnl=float(pnl),
            risk_amount=None if risk is None else float(risk),
            session=row.get("session"),
        )


@dataclass(frozen=True)
class PerformanceSummary:
    total_trades: int
    winning_trades: int
    losing_trades: int
    breakeven_trades: int
    win_rate_percent: float | None
    average_win_r: float | None
    average_loss_r: float | None
    expectancy_r: float | None
    profit_factor: float | None
    total_r: float | None
    net_pnl: float
    max_drawdown: float
    longest_losing_streak: int


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _round(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(value, digits)


def summarize(trades: Iterable[ClosedTrade]) -> PerformanceSummary:
    """Summarise closed trades in the order they were closed."""
    ordered = sorted(trades, key=lambda trade: trade.closed_at)
    if not ordered:
        return PerformanceSummary(0, 0, 0, 0, None, None, None, None, None, None, 0.0, 0.0, 0)

    wins = [t for t in ordered if t.pnl > 0]
    losses = [t for t in ordered if t.pnl < 0]
    gross_profit = sum(t.pnl for t in wins)
    gross_loss = -sum(t.pnl for t in losses)

    r_all = [r for t in ordered if (r := t.r_multiple) is not None]
    r_wins = [r for t in wins if (r := t.r_multiple) is not None]
    r_losses = [r for t in losses if (r := t.r_multiple) is not None]

    peak = cumulative = max_drawdown = 0.0
    streak = longest_streak = 0
    for trade in ordered:
        cumulative += trade.pnl
        peak = max(peak, cumulative)
        max_drawdown = max(max_drawdown, peak - cumulative)
        if trade.pnl < 0:
            streak += 1
            longest_streak = max(longest_streak, streak)
        else:
            streak = 0

    return PerformanceSummary(
        total_trades=len(ordered),
        winning_trades=len(wins),
        losing_trades=len(losses),
        breakeven_trades=len(ordered) - len(wins) - len(losses),
        win_rate_percent=_round(100.0 * len(wins) / len(ordered), 1),
        average_win_r=_round(_mean(r_wins)),
        average_loss_r=_round(_mean(r_losses)),
        expectancy_r=_round(_mean(r_all)),
        profit_factor=_round(gross_profit / gross_loss) if gross_loss > 0 else None,
        total_r=_round(sum(r_all)) if r_all else None,
        net_pnl=round(sum(t.pnl for t in ordered), 2),
        max_drawdown=round(max_drawdown, 2),
        longest_losing_streak=longest_streak,
    )


def summarize_by_session(trades: Iterable[ClosedTrade]) -> dict[str, PerformanceSummary]:
    """Summarise per trading session. Trades without a session group under ``unspecified``."""
    groups: dict[str, list[ClosedTrade]] = {}
    for trade in trades:
        groups.setdefault(trade.session or UNSPECIFIED_SESSION, []).append(trade)
    return {session: summarize(groups[session]) for session in sorted(groups)}