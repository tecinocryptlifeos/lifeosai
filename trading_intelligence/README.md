# Trading Intelligence Engine

This package is the deterministic research core behind the LifeOS Trading Intelligence surface.

## Dependency order

1. **Research data model** — immutable bars, causal pivots, strategy definitions, risk policies and experiment specifications.
2. **Market-structure engine** — confirmed swing structure and regime state. A pivot becomes usable only at its confirmation bar.
3. **Strategy definitions** — versioned entry/exit rules with explicit causal inputs and invalidation rules.
4. **Causal indicator layer** — same-index calculations with explicit warm-up periods.
5. **Risk engine** — position sizing plus portfolio exposure, drawdown and correlated-exposure gates.
6. **LONA experiment adapter** — deterministic request construction for the external Backtrader/LONA layer; it does not alter strategy logic.
7. **Validation gates** — chronological integrity, separated development/evaluation periods and walk-forward windows.

## Non-negotiable invariants

- No future information may influence a historical signal.
- Repainting ZigZag/swing information is never treated as an entry-time fact.
- Costs and execution assumptions belong to the experiment specification, not hidden inside a strategy.
- Development performance is not production approval.
- A candidate must pass independent validation and risk review before release.
- External providers are adapters, not authorities for the trading model.

## Next engineering slice

The core contracts are now in place. The next slice should add an experiment ledger and result schema, then connect a controlled LONA run using an explicitly versioned strategy definition. Real market data should be selected per experiment and never mixed silently across asset classes or timeframes.
