# LifeOS Trading Intelligence — Integration Boundary

This document records the production integration boundary for the Trading Intelligence console.

- The research engine is repository code and is deterministic/read-only at the deployed console.
- Supabase is the persisted public experiment ledger.
- The completed LONA experiment is evidence surfaced by the console; it is not live-order authorization.
- Alpaca and Blockscout are not represented as live production integrations unless application-side credentials and routes are deployed and verified.
- Gemini is not part of backtest execution.
- Cloudflare Pages and the Worker are considered production only after the GitHub Actions deployment completes successfully and live endpoint checks pass.

Release chain:

`Research data → causal structure → versioned strategy → risk gates → controlled LONA experiment → persisted experiment ledger → production evidence console.`
