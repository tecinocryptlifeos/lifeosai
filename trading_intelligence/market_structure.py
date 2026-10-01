from __future__ import annotations
from collections.abc import Sequence
from .model import Bar, Pivot, StructureState

def confirmed_pivots(bars: Sequence[Bar], left: int = 2, right: int = 2) -> tuple[Pivot, ...]:
    """Find swings, but make them usable only at the bar where confirmation arrives."""
    if left < 1 or right < 1:
        raise ValueError("left and right must be positive")
    out: list[Pivot] = []
    for i in range(left, len(bars) - right):
        window = bars[i-left:i+right+1]
        if bars[i].high == max(b.high for b in window) and sum(b.high == bars[i].high for b in window) == 1:
            out.append(Pivot(i, bars[i].timestamp, bars[i].high, "high", i + right))
        if bars[i].low == min(b.low for b in window) and sum(b.low == bars[i].low for b in window) == 1:
            out.append(Pivot(i, bars[i].timestamp, bars[i].low, "low", i + right))
    return tuple(out)

def structure_state(bars: Sequence[Bar], pivots: Sequence[Pivot]) -> tuple[StructureState, ...]:
    """Build state causally: a future-confirmed pivot is invisible before confirmation."""
    states: list[StructureState] = []
    highs: list[Pivot] = []
    lows: list[Pivot] = []
    by_confirmation: dict[int, list[Pivot]] = {}
    for pivot in pivots:
        if not pivot.causal:
            raise ValueError("non-causal pivot supplied")
        by_confirmation.setdefault(pivot.confirmation_index, []).append(pivot)
    for i in range(len(bars)):
        for pivot in by_confirmation.get(i, []):
            (highs if pivot.kind == "high" else lows).append(pivot)
        events: list[str] = []
        if len(highs) >= 2:
            if highs[-1].price > highs[-2].price: events.append("higher_high")
            if highs[-1].price < highs[-2].price: events.append("lower_high")
        if len(lows) >= 2:
            if lows[-1].price > lows[-2].price: events.append("higher_low")
            if lows[-1].price < lows[-2].price: events.append("lower_low")
        if "higher_high" in events and "higher_low" in events: regime = "uptrend"
        elif "lower_high" in events and "lower_low" in events: regime = "downtrend"
        elif highs and lows: regime = "range"
        else: regime = "undetermined"
        states.append(StructureState(regime, highs[-1] if highs else None, lows[-1] if lows else None, tuple(events)))
    return tuple(states)
