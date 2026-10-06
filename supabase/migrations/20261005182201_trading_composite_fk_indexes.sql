-- Composite indexes for owner-scoped foreign-key lookups.
create index trading_setups_strategy_owner_idx
  on public.trading_setups (strategy_id, user_id) where strategy_id is not null;
create index trading_trades_setup_owner_idx
  on public.trading_trades (setup_id, user_id) where setup_id is not null;
create index trading_trades_strategy_owner_idx
  on public.trading_trades (strategy_id, user_id) where strategy_id is not null;
