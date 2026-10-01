from __future__ import annotations
from collections.abc import Sequence
from math import sqrt
from .model import Bar

def sma(values: Sequence[float], period: int) -> tuple[float | None, ...]:
    if period < 1: raise ValueError("period must be positive")
    return tuple(None if i + 1 < period else sum(values[i-period+1:i+1]) / period for i in range(len(values)))

def true_range(bars: Sequence[Bar]) -> tuple[float, ...]:
    out: list[float] = []
    previous_close: float | None = None
    for bar in bars:
        out.append(bar.high - bar.low if previous_close is None else max(bar.high-bar.low, abs(bar.high-previous_close), abs(bar.low-previous_close)))
        previous_close = bar.close
    return tuple(out)

def atr(bars: Sequence[Bar], period: int = 14) -> tuple[float | None, ...]:
    if period < 1: raise ValueError("period must be positive")
    tr = true_range(bars)
    return tuple(None if i + 1 < period else sum(tr[i-period+1:i+1]) / period for i in range(len(bars)))

def zscore(values: Sequence[float], period: int = 20) -> tuple[float | None, ...]:
    if period < 2: raise ValueError("period must be at least 2")
    out: list[float | None] = []
    for i in range(len(values)):
        if i + 1 < period: out.append(None); continue
        window = values[i-period+1:i+1]; mean = sum(window)/period
        variance = sum((x-mean)**2 for x in window)/period; sd = sqrt(variance)
        out.append(None if sd == 0 else (values[i]-mean)/sd)
    return tuple(out)

def assert_causal_series(bars: Sequence[Bar], values: Sequence[float | None]) -> None:
    if len(bars) != len(values): raise ValueError("indicator length must match bars")
    if any(v is not None and not isinstance(v, (int, float)) for v in values): raise ValueError("indicator values must be numeric")
