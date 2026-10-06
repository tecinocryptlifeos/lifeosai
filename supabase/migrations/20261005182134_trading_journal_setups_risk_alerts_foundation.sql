-- LifeOS Trading Intelligence: instruments, strategies, risk profile, setups, journal, alerts.
-- Additive only. Existing trading_experiments / results / gates / public results are untouched.
-- Applied to the lifeos-ai-auth-admin Supabase project on 2026-10-05 as two migrations
-- (trading_journal_setups_risk_alerts_foundation, trading_composite_fk_indexes).
-- This file is the combined, final form for version control.

-- Shared updated_at trigger function (explicit search_path, no table access).
create function public.trading_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 1. Instruments: shared reference catalogue (read-only for users, written server-side).
create table public.trading_instruments (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique
    check (symbol = upper(symbol) and symbol ~ '^[A-Z0-9._-]{2,20}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  asset_class text not null
    check (asset_class in ('forex', 'equity', 'index', 'crypto', 'commodity', 'etf')),
  base_currency text,
  quote_currency text,
  pip_size numeric(18, 8) not null check (pip_size > 0),
  price_decimals smallint not null check (price_decimals between 0 and 8),
  contract_size numeric(18, 4) not null default 1 check (contract_size > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.trading_instruments is
  'Tradable instrument catalogue. pip_size and contract_size follow common conventions and can differ by broker.';

-- 2. Strategies: user-owned strategy definitions (Strategy Lab).
create table public.trading_strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 4000),
  asset_class text
    check (asset_class in ('forex', 'equity', 'index', 'crypto', 'commodity', 'etf')),
  timeframes text[] not null default '{}'
    check (timeframes <@ array['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1']::text[]),
  rules jsonb not null default '{}'::jsonb check (jsonb_typeof(rules) = 'object'),
  default_risk_percent numeric(5, 2) check (default_risk_percent > 0 and default_risk_percent <= 10),
  version integer not null default 1 check (version > 0),
  status text not null default 'draft'
    check (status in ('draft', 'testing', 'validated', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, name)
);
comment on table public.trading_strategies is
  'User-owned strategy definitions. Owner-only access through row-level security.';

-- 3. Risk profile: one row per user, drives the risk engine warnings.
create table public.trading_risk_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  account_currency text not null default 'USD' check (account_currency ~ '^[A-Z]{3}$'),
  account_balance numeric(18, 2) not null default 0 check (account_balance >= 0),
  default_risk_percent numeric(5, 2) not null default 1.00
    check (default_risk_percent > 0 and default_risk_percent <= 10),
  max_risk_per_trade_percent numeric(5, 2) not null default 2.00
    check (max_risk_per_trade_percent > 0 and max_risk_per_trade_percent <= 10),
  max_daily_loss_percent numeric(5, 2) not null default 3.00
    check (max_daily_loss_percent > 0 and max_daily_loss_percent <= 100),
  max_open_risk_percent numeric(5, 2) not null default 5.00
    check (max_open_risk_percent > 0 and max_open_risk_percent <= 100),
  max_open_positions integer not null default 5 check (max_open_positions between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (default_risk_percent <= max_risk_per_trade_percent)
);
comment on table public.trading_risk_profiles is
  'Per-user risk limits and account settings used by the risk engine.';

-- 4. Setups: planned trades from the Trade Setup Builder.
create table public.trading_setups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  instrument_id uuid not null references public.trading_instruments (id),
  strategy_id uuid,
  direction text not null check (direction in ('buy', 'sell')),
  timeframe text not null check (timeframe in ('M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1')),
  status text not null default 'draft'
    check (status in ('draft', 'watching', 'ready', 'triggered', 'expired', 'cancelled')),
  entry_price numeric(18, 8) not null check (entry_price > 0),
  stop_loss numeric(18, 8) not null check (stop_loss > 0),
  take_profit numeric(18, 8) check (take_profit > 0),
  risk_percent numeric(5, 2) check (risk_percent > 0 and risk_percent <= 10),
  account_balance numeric(18, 2) check (account_balance >= 0),
  risk_amount numeric(18, 2) check (risk_amount >= 0),
  position_size numeric(18, 4) check (position_size >= 0),
  risk_reward numeric(10, 2) generated always as (
    case
      when take_profit is not null
      then round(abs(take_profit - entry_price) / nullif(abs(entry_price - stop_loss), 0), 2)
    end
  ) stored,
  htf_bias text check (htf_bias in ('bullish', 'bearish', 'neutral')),
  htf_aligned boolean,
  entry_confirmed boolean not null default false,
  quality_score smallint check (quality_score between 0 and 100),
  quality_breakdown jsonb not null default '{}'::jsonb
    check (jsonb_typeof(quality_breakdown) = 'object'),
  invalidation text not null default '' check (char_length(invalidation) <= 2000),
  thesis text not null default '' check (char_length(thesis) <= 4000),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint trading_setups_strategy_owner_fkey    foreign key (strategy_id, user_id)
    references public.trading_strategies (id, user_id)
    on delete set null (strategy_id),
  constraint trading_setups_stop_side check (
    (direction = 'buy' and stop_loss < entry_price)
    or (direction = 'sell' and stop_loss > entry_price)
  ),
  constraint trading_setups_target_side check (
    take_profit is null
    or (direction = 'buy' and take_profit > entry_price)
    or (direction = 'sell' and take_profit < entry_price)
  )
);
comment on table public.trading_setups is
  'Planned trade setups. Stop and target must sit on the correct side of entry for the chosen direction.';

-- 5. Trades: the journal. pnl_amount is the net result after fees, in account currency.
create table public.trading_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  instrument_id uuid not null references public.trading_instruments (id),
  setup_id uuid,
  strategy_id uuid,
  direction text not null check (direction in ('buy', 'sell')),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  session text
    check (session in ('asia', 'london', 'new_york', 'london_new_york_overlap', 'off_hours')),
  setup_type text check (char_length(setup_type) <= 80),
  opened_at timestamptz not null,
  closed_at timestamptz,
  entry_price numeric(18, 8) not null check (entry_price > 0),
  exit_price numeric(18, 8) check (exit_price > 0),
  stop_loss numeric(18, 8) check (stop_loss > 0),
  take_profit numeric(18, 8) check (take_profit > 0),
  position_size numeric(18, 4) not null check (position_size > 0),
  risk_amount numeric(18, 2) check (risk_amount >= 0),
  risk_percent numeric(5, 2) check (risk_percent > 0 and risk_percent <= 10),
  fees numeric(18, 2) not null default 0,
  pnl_amount numeric(18, 2),
  r_multiple numeric(10, 2) generated always as (
    case
      when risk_amount > 0 and pnl_amount is not null
      then round(pnl_amount / risk_amount, 2)
    end
  ) stored,
  reason_for_entry text not null default '' check (char_length(reason_for_entry) <= 4000),
  emotional_state text not null default '' check (char_length(emotional_state) <= 1000),
  execution_quality smallint check (execution_quality between 1 and 5),
  lesson text not null default '' check (char_length(lesson) <= 4000),
  screenshot_path text check (char_length(screenshot_path) <= 500),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint trading_trades_setup_owner_fkey
    foreign key (setup_id, user_id)
    references public.trading_setups (id, user_id)
    on delete set null (setup_id),
  constraint trading_trades_strategy_owner_fkey
    foreign key (strategy_id, user_id)
    references public.trading_strategies (id, user_id)
    on delete set null (strategy_id),
  constraint trading_trades_closed_requires_result check (
    status <> 'closed'
    or (exit_price is not null and closed_at is not null and pnl_amount is not null)
  ),
  constraint trading_trades_close_after_open check (closed_at is null or closed_at >= opened_at)
);
comment on table public.trading_trades is
  'Trading journal entries. r_multiple is derived from pnl_amount and risk_amount.';

-- 6. Alerts.
create table public.trading_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  instrument_id uuid references public.trading_instruments (id),
  alert_type text not null check (alert_type in ('price', 'structure', 'setup', 'volatility', 'risk')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  condition jsonb not null check (jsonb_typeof(condition) = 'object'),
  status text not null default 'active' check (status in ('active', 'triggered', 'paused', 'cancelled')),
  triggered_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (alert_type = 'risk' or instrument_id is not null)
);
comment on table public.trading_alerts is
  'User alerts. Only risk alerts may omit an instrument.';

-- Indexes (foreign keys and the main access paths).
create index trading_strategies_user_idx on public.trading_strategies (user_id, status);
create index trading_setups_user_status_idx on public.trading_setups (user_id, status, created_at desc);
create index trading_setups_instrument_idx on public.trading_setups (instrument_id);
create index trading_alerts_user_idx on public.trading_alerts (user_id, status);
create index trading_alerts_instrument_idx on public.trading_alerts (instrument_id) where instrument_id is not null;
create index trading_alerts_active_idx on public.trading_alerts (instrument_id) where status = 'active';

-- updated_at triggers.
do $$
declare t text;
begin
  foreach t in array array[
    'trading_instruments', 'trading_strategies', 'trading_risk_profiles',
    'trading_setups', 'trading_trades', 'trading_alerts'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.trading_set_updated_at()',
      t || '_updated_at', t
    );
  end loop;
end
$$;

-- Row-level security: owner-only access on user tables.
alter table public.trading_instruments enable row level security;
alter table public.trading_strategies enable row level security;
alter table public.trading_risk_profiles enable row level security;
alter table public.trading_setups enable row level security;
alter table public.trading_trades enable row level security;
alter table public.trading_alerts enable row level security;

create policy trading_instruments_authenticated_select
  on public.trading_instruments for select to authenticated using (true);

do $$
declare t text;
begin
  foreach t in array array[
    'trading_strategies', 'trading_risk_profiles', 'trading_setups', 'trading_trades', 'trading_alerts'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t || '_owner_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t || '_owner_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_owner_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t || '_owner_delete', t);
  end loop;
end
$$;

-- Least-privilege grants: no anonymous access to any new table.
revoke all on public.trading_instruments, public.trading_strategies, public.trading_risk_profiles,
  public.trading_setups, public.trading_trades, public.trading_alerts from anon;
grant select on public.trading_instruments to authenticated;
grant select, insert, update, delete on public.trading_strategies, public.trading_risk_profiles,
  public.trading_setups, public.trading_trades, public.trading_alerts to authenticated;

-- Performance analytics. security_invoker makes the views respect each caller's row-level security.
create view public.trading_performance_summary
with (security_invoker = true) as
select
  user_id,
  count(*)::integer as total_trades,
  (count(*) filter (where pnl_amount > 0))::integer as winning_trades,
  (count(*) filter (where pnl_amount < 0))::integer as losing_trades,
  round(100.0 * count(*) filter (where pnl_amount > 0) / nullif(count(*), 0), 1) as win_rate_percent,
  round(avg(r_multiple) filter (where pnl_amount > 0), 2) as average_win_r,
  round(avg(r_multiple) filter (where pnl_amount < 0), 2) as average_loss_r,
  round(avg(r_multiple), 2) as expectancy_r,
  round(
    sum(pnl_amount) filter (where pnl_amount > 0)
    / nullif(abs(sum(pnl_amount) filter (where pnl_amount < 0)), 0),
    2
  ) as profit_factor,
  round(sum(r_multiple), 2) as total_r,
  round(sum(pnl_amount), 2) as net_pnl
from public.trading_trades
where status = 'closed'
group by user_id;

create view public.trading_performance_by_session
with (security_invoker = true) as
select
  user_id,
  coalesce(session, 'unspecified') as session,
  count(*)::integer as total_trades,
  round(100.0 * count(*) filter (where pnl_amount > 0) / nullif(count(*), 0), 1) as win_rate_percent,
  round(sum(r_multiple), 2) as total_r,
  round(avg(r_multiple), 2) as expectancy_r
from public.trading_trades
where status = 'closed'
group by user_id, coalesce(session, 'unspecified');

revoke all on public.trading_performance_summary, public.trading_performance_by_session from anon;
grant select on public.trading_performance_summary, public.trading_performance_by_session to authenticated;

-- Starting instrument catalogue. Pip and contract sizes are common conventions; verify against your broker.
insert into public.trading_instruments
  (symbol, display_name, asset_class, base_currency, quote_currency, pip_size, price_decimals, contract_size)
values
  ('EURUSD', 'Euro / US Dollar', 'forex', 'EUR', 'USD', 0.0001, 5, 100000),
  ('GBPUSD', 'British Pound / US Dollar', 'forex', 'GBP', 'USD', 0.0001, 5, 100000),
  ('USDJPY', 'US Dollar / Japanese Yen', 'forex', 'USD', 'JPY', 0.01, 3, 100000),
  ('AUDUSD', 'Australian Dollar / US Dollar', 'forex', 'AUD', 'USD', 0.0001, 5, 100000),
  ('USDCAD', 'US Dollar / Canadian Dollar', 'forex', 'USD', 'CAD', 0.0001, 5, 100000),
  ('USDCHF', 'US Dollar / Swiss Franc', 'forex', 'USD', 'CHF', 0.0001, 5, 100000),
  ('NZDUSD', 'New Zealand Dollar / US Dollar', 'forex', 'NZD', 'USD', 0.0001, 5, 100000),
  ('XAUUSD', 'Gold / US Dollar', 'commodity', 'XAU', 'USD', 0.1, 2, 100),
  ('BTCUSD', 'Bitcoin / US Dollar', 'crypto', 'BTC', 'USD', 1, 2, 1);
