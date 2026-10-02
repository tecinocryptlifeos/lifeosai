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

## Current integration state

The experiment ledger and public result schema are now present in Supabase. A completed, versioned LONA run is persisted and surfaced by the production Trading Intelligence page through the public read-only ledger.

The deployed console is intentionally read-only: it verifies research evidence and risk boundaries but does not place live orders.

Provider boundary: the repository contains the deterministic LONA request adapter, but the LONA connector available to the development agent is not itself a credential/API endpoint exposed to the production web application. Alpaca is likewise available to the development environment but is not wired into the deployed page. These must not be represented as live production integrations until an application-side provider credential and server route are provisioned.

## Release path

Research data → causal structure → versioned strategy → risk gates → controlled LONA experiment → persisted experiment ledger → production evidence console.

No production approval is inferred from a single backtest.
