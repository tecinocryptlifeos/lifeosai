-- LifeOS account completion migration v2.1.0
-- Run once in Supabase SQL Editor before enabling public email registration.

alter table public.lifeos_profiles add column if not exists first_name text;
alter table public.lifeos_profiles add column if not exists surname text;
alter table public.lifeos_profiles add column if not exists date_of_birth date;
alter table public.lifeos_profiles add column if not exists country text;
alter table public.lifeos_profiles add column if not exists phone text;
alter table public.lifeos_profiles add column if not exists terms_accepted_at timestamptz;

create or replace function public.lifeos_safe_date(value text)
returns date
language plpgsql
immutable
as $$
begin
  return nullif(value,'')::date;
exception when others then
  return null;
end;
$$;

create or replace function public.lifeos_safe_timestamptz(value text)
returns timestamptz
language plpgsql
stable
as $$
begin
  return nullif(value,'')::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function public.lifeos_sync_profile()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  dob date;
  first_value text;
  surname_value text;
  full_value text;
begin
  first_value := nullif(btrim(coalesce(new.raw_user_meta_data->>'first_name','')), '');
  surname_value := nullif(btrim(coalesce(new.raw_user_meta_data->>'surname','')), '');
  full_value := nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name','')), '');
  if nullif(new.raw_user_meta_data->>'date_of_birth','') is not null then
    begin
      dob := (new.raw_user_meta_data->>'date_of_birth')::date;
    exception when others then
      raise exception 'Invalid date of birth';
    end;
    if dob > current_date - interval '13 years' then
      raise exception 'LifeOS accounts require a minimum age of 13';
    end if;
  end if;

  insert into public.lifeos_profiles(
    user_id,email,display_name,first_name,surname,date_of_birth,country,phone,
    terms_accepted_at,created_at,last_sign_in_at
  ) values(
    new.id,new.email,coalesce(full_value,concat_ws(' ',first_value,surname_value)),
    first_value,surname_value,dob,
    nullif(btrim(coalesce(new.raw_user_meta_data->>'country','')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data->>'phone','')), ''),
    nullif(new.raw_user_meta_data->>'terms_accepted_at','')::timestamptz,
    coalesce(new.created_at,now()),new.last_sign_in_at
  )
  on conflict(user_id) do update set
    email=excluded.email,
    display_name=coalesce(excluded.display_name,lifeos_profiles.display_name),
    first_name=coalesce(excluded.first_name,lifeos_profiles.first_name),
    surname=coalesce(excluded.surname,lifeos_profiles.surname),
    date_of_birth=coalesce(excluded.date_of_birth,lifeos_profiles.date_of_birth),
    country=coalesce(excluded.country,lifeos_profiles.country),
    phone=coalesce(excluded.phone,lifeos_profiles.phone),
    terms_accepted_at=coalesce(excluded.terms_accepted_at,lifeos_profiles.terms_accepted_at),
    last_sign_in_at=excluded.last_sign_in_at;
  return new;
end;
$$;

drop trigger if exists lifeos_auth_user_sync on auth.users;
create trigger lifeos_auth_user_sync
after insert or update on auth.users
for each row execute procedure public.lifeos_sync_profile();

-- Backfill current Auth users without modifying auth.users.
insert into public.lifeos_profiles(
  user_id,email,display_name,first_name,surname,date_of_birth,country,phone,
  terms_accepted_at,created_at,last_sign_in_at
)
select
  u.id,
  u.email,
  coalesce(
    nullif(btrim(coalesce(u.raw_user_meta_data->>'full_name','')), ''),
    nullif(btrim(coalesce(u.raw_user_meta_data->>'name','')), ''),
    nullif(btrim(concat_ws(' ',u.raw_user_meta_data->>'first_name',u.raw_user_meta_data->>'surname')), '')
  ),
  nullif(btrim(coalesce(u.raw_user_meta_data->>'first_name','')), ''),
  nullif(btrim(coalesce(u.raw_user_meta_data->>'surname','')), ''),
  public.lifeos_safe_date(u.raw_user_meta_data->>'date_of_birth'),
  nullif(btrim(coalesce(u.raw_user_meta_data->>'country','')), ''),
  nullif(btrim(coalesce(u.raw_user_meta_data->>'phone','')), ''),
  public.lifeos_safe_timestamptz(u.raw_user_meta_data->>'terms_accepted_at'),
  coalesce(u.created_at,now()),
  u.last_sign_in_at
from auth.users u
on conflict(user_id) do update set
  email=excluded.email,
  display_name=coalesce(excluded.display_name,lifeos_profiles.display_name),
  first_name=coalesce(excluded.first_name,lifeos_profiles.first_name),
  surname=coalesce(excluded.surname,lifeos_profiles.surname),
  date_of_birth=coalesce(excluded.date_of_birth,lifeos_profiles.date_of_birth),
  country=coalesce(excluded.country,lifeos_profiles.country),
  phone=coalesce(excluded.phone,lifeos_profiles.phone),
  terms_accepted_at=coalesce(excluded.terms_accepted_at,lifeos_profiles.terms_accepted_at),
  last_sign_in_at=excluded.last_sign_in_at;
