-- Run once in Supabase SQL Editor.
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
create or replace function public.lifeos_sync_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.lifeos_profiles(user_id,email,display_name,created_at,last_sign_in_at)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name'),coalesce(new.created_at,now()),new.last_sign_in_at)
  on conflict(user_id) do update set email=excluded.email,display_name=coalesce(excluded.display_name,lifeos_profiles.display_name),last_sign_in_at=excluded.last_sign_in_at;
  return new;
end;$$;
drop trigger if exists lifeos_auth_user_sync on auth.users;
create trigger lifeos_auth_user_sync after insert or update on auth.users for each row execute procedure public.lifeos_sync_profile();
alter table public.lifeos_profiles enable row level security;
alter table public.lifeos_events enable row level security;
-- No browser policies are created. All analytics reads/writes go through the LifeOS server using the service-role key.
