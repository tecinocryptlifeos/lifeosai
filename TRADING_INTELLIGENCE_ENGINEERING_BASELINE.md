# LifeOS Trading Intelligence — Engineering Baseline

## Objective
Build a research-first trading intelligence layer covering forex, equities, indices and crypto. The system must distinguish research evidence from assumptions and must never promote a strategy solely because a historical result looks attractive.

## Core pipeline
Inspect → Hypothesis → Causal rules → Backtest → Stress test → Walk-forward validation → Risk audit → Independent review → Release.

## Strategy research
The research library may include candlestick structures, market structure, trend/range models, momentum, mean reversion, volatility, breakout/pullback logic, indicators and swing/ZigZag-derived structure.

ZigZag-derived signals must be causal. Confirmed pivots may be used only after the pivot is knowable in real time. Repainting or future-confirmed swing information must not leak into historical entries.

## Validation controls
- Separate development and evaluation periods.
- Prefer rolling/walk-forward validation.
- Model spread, slippage, fees and realistic execution.
- Test multiple market regimes.
- Check look-ahead and survivorship bias.
- Check overfitting and data-mining effects.
- Run sensitivity analysis on parameters.
- Include adverse/fat-tail scenarios.
- Keep a reproducible experiment record.

## Risk controls
Risk is evaluated at position, strategy and portfolio levels. The system should support position limits, exposure limits, drawdown limits, scenario limits, volatility-aware sizing and correlation checks.

## Release rule
No strategy is marked production-ready from a single backtest. A candidate must survive independent validation and risk review.

## Evidence
CFA Institute's 2026 guidance identifies rolling/walk-forward backtesting, scenario analysis and sensitivity analysis as complementary tools and highlights look-ahead bias, survivorship bias, fat tails and structural breaks as important limitations. Trade execution should account for liquidity, spreads, volatility and market impact.

## Current implementation
Homepage: /trading.html
Background: existing repository asset /assets/lifeos-home-king-bg.webp
