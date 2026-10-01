from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime
from collections.abc import Sequence

@dataclass(frozen=True)
class ValidationGate:
    name: str
    passed: bool
    evidence: str

@dataclass(frozen=True)
class ValidationResult:
    passed: bool
    gates: tuple[ValidationGate, ...]

def validate_experiment_periods(development_end: datetime, evaluation_end: datetime, final_end: datetime) -> ValidationResult:
    gates=(ValidationGate("ordered_periods", development_end < evaluation_end < final_end, "development < evaluation < final"), ValidationGate("non_overlapping", development_end <= evaluation_end, "evaluation begins after development"))
    return ValidationResult(all(g.passed for g in gates), gates)

def check_timestamp_order(timestamps: Sequence[datetime]) -> ValidationGate:
    return ValidationGate("strict_timestamp_order", all(a < b for a,b in zip(timestamps,timestamps[1:])), "bars must be strictly chronological")

def walk_forward_windows(start: datetime, end: datetime, development_bars: int, evaluation_bars: int, step_bars: int, total_bars: int) -> tuple[tuple[int,int,int,int], ...]:
    if min(development_bars,evaluation_bars,step_bars)<1 or start>=end: raise ValueError("invalid walk-forward specification")
    windows=[]; cursor=0
    while cursor+development_bars+evaluation_bars<=total_bars:
        windows.append((cursor,cursor+development_bars,cursor+development_bars,cursor+development_bars+evaluation_bars)); cursor+=step_bars
    return tuple(windows)
