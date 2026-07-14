-- Run once in Supabase SQL Editor.
-- The transaction is all-or-nothing. Browser roles receive no table access;
-- only the LifeOS server's service role can read profiles or write/read events.
begin;

create extension if not exists pgcrypto;
create table if not exists public.lifeos_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz,
  account_status text not null default 'active'
);
create table if not exists public.lifeos_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  event_type text not null,
  session_id text,
  error_code text,
  error_message text,
  device_type text,
  browser text,
  client_ip text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists lifeos_events_created_at_idx on public.lifeos_events(created_at desc);
create index if not exists lifeos_events_user_id_idx on public.lifeos_events(user_id);
create or replace function public.lifeos_sync_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.lifeos_profiles as profile(user_id,email,display_name,created_at,last_sign_in_at)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name'),coalesce(new.created_at,now()),new.last_sign_in_at)
  on conflict(user_id) do update set
    email=excluded.email,
    display_name=coalesce(excluded.display_name,profile.display_name),
    last_sign_in_at=excluded.last_sign_in_at;
  return new;
end;
$$;
drop trigger if exists lifeos_auth_user_sync on auth.users;
create trigger lifeos_auth_user_sync after insert or update on auth.users for each row execute function public.lifeos_sync_profile();
alter table public.lifeos_profiles enable row level security;
alter table public.lifeos_events enable row level security;

-- Project creation disabled automatic table exposure. Keep browser roles locked
-- out and grant only the minimum Data API privileges used by the LifeOS server.
revoke all on table public.lifeos_profiles from anon, authenticated, service_role;
revoke all on table public.lifeos_events from anon, authenticated, service_role;
grant usage on schema public to service_role;
grant select on table public.lifeos_profiles to service_role;
grant select, insert on table public.lifeos_events to service_role;

-- Trigger functions are internal and must not become public RPC endpoints.
revoke all on function public.lifeos_sync_profile() from public, anon, authenticated, service_role;

-- No browser policies are created. All analytics reads/writes go through the
-- LifeOS server using its secret key.
commit;
