-- LIFEOS_QUEUE_V1_0_1
-- Human-facing name: LifeOS Queue
-- Technical identifier: lifeos_queue
-- Disabled by default. No Gmail credentials are stored here.

begin;

create table if not exists public.lifeos_queue_settings (
    singleton_id boolean primary key default true check (singleton_id = true),
    display_name text not null default 'LifeOS Queue',
    technical_name text not null default 'lifeos_queue',
    enabled boolean not null default false,
    sender_email text not null default 'losaiadminpatric@gmail.com',
    daily_send_limit integer not null default 10
        check (daily_send_limit between 1 and 100),
    send_interval_minutes integer not null default 30
        check (send_interval_minutes between 1 and 1440),
    reply_sync_minutes integer not null default 15
        check (reply_sync_minutes between 1 and 1440),
    lock_timeout_minutes integer not null default 10
        check (lock_timeout_minutes between 1 and 120),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

insert into public.lifeos_queue_settings (
    singleton_id, display_name, technical_name, enabled, sender_email,
    daily_send_limit, send_interval_minutes, reply_sync_minutes,
    lock_timeout_minutes
)
values (
    true, 'LifeOS Queue', 'lifeos_queue', false,
    'losaiadminpatric@gmail.com', 10, 30, 15, 10
)
on conflict (singleton_id) do nothing;

create table if not exists public.lifeos_queue_messages (
    id uuid primary key default gen_random_uuid(),
    direction text not null default 'outbound'
        check (direction in ('outbound', 'inbound')),
    message_type text not null default 'invitation'
        check (message_type in (
            'invitation', 'welcome', 'follow_up', 'reply', 'administrative'
        )),
    status text not null default 'queued'
        check (status in (
            'queued', 'scheduled', 'processing', 'sent', 'delivered',
            'replied', 'failed', 'cancelled'
        )),
    sender_email text,
    recipient_email text not null,
    recipient_name text,
    subject text not null,
    body_text text not null,
    body_html text,
    invitation_url text,
    scheduled_at timestamptz not null default now(),
    locked_at timestamptz,
    lock_owner text,
    attempts integer not null default 0 check (attempts >= 0),
    max_attempts integer not null default 3
        check (max_attempts between 1 and 10),
    sent_at timestamptz,
    delivered_at timestamptz,
    replied_at timestamptz,
    failed_at timestamptz,
    gmail_message_id text,
    gmail_thread_id text,
    gmail_history_id text,
    parent_message_id uuid
        references public.lifeos_queue_messages(id) on delete set null,
    idempotency_key text unique,
    last_error text,
    metadata jsonb not null default '{}'::jsonb,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.lifeos_queue_runs (
    id uuid primary key default gen_random_uuid(),
    run_type text not null
        check (run_type in (
            'send_dispatch', 'reply_sync', 'manual_test', 'maintenance'
        )),
    worker_id text not null,
    status text not null
        check (status in ('started', 'completed', 'failed', 'skipped')),
    processed_count integer not null default 0 check (processed_count >= 0),
    success_count integer not null default 0 check (success_count >= 0),
    failed_count integer not null default 0 check (failed_count >= 0),
    details jsonb not null default '{}'::jsonb,
    started_at timestamptz not null default now(),
    completed_at timestamptz
);

create index if not exists lifeos_queue_messages_due_idx
on public.lifeos_queue_messages (status, scheduled_at, created_at)
where direction = 'outbound';

create index if not exists lifeos_queue_messages_thread_idx
on public.lifeos_queue_messages (gmail_thread_id)
where gmail_thread_id is not null;

create unique index if not exists lifeos_queue_messages_gmail_message_unique_idx
on public.lifeos_queue_messages (gmail_message_id)
where gmail_message_id is not null;

create index if not exists lifeos_queue_messages_recipient_idx
on public.lifeos_queue_messages (lower(recipient_email), created_at desc);

create or replace function public.lifeos_queue_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists lifeos_queue_settings_updated_at
on public.lifeos_queue_settings;

create trigger lifeos_queue_settings_updated_at
before update on public.lifeos_queue_settings
for each row execute function public.lifeos_queue_set_updated_at();

drop trigger if exists lifeos_queue_messages_updated_at
on public.lifeos_queue_messages;

create trigger lifeos_queue_messages_updated_at
before update on public.lifeos_queue_messages
for each row execute function public.lifeos_queue_set_updated_at();

create or replace function public.lifeos_queue_claim_next(p_worker_id text)
returns setof public.lifeos_queue_messages
language plpgsql
security definer
set search_path = public
as $$
declare
    v_enabled boolean;
    v_daily_limit integer;
    v_lock_timeout integer;
    v_sent_today integer;
begin
    if nullif(trim(p_worker_id), '') is null then
        raise exception 'LifeOS Queue worker ID is required';
    end if;

    select enabled, daily_send_limit, lock_timeout_minutes
      into v_enabled, v_daily_limit, v_lock_timeout
      from public.lifeos_queue_settings
     where singleton_id = true;

    if coalesce(v_enabled, false) = false then
        return;
    end if;

    select count(*)
      into v_sent_today
      from public.lifeos_queue_messages
     where direction = 'outbound'
       and sent_at >= date_trunc('day', now())
       and sent_at < date_trunc('day', now()) + interval '1 day';

    if v_sent_today >= v_daily_limit then
        return;
    end if;

    return query
    with candidate as (
        select message.id
          from public.lifeos_queue_messages as message
         where message.direction = 'outbound'
           and message.status in ('queued', 'scheduled')
           and message.scheduled_at <= now()
           and message.attempts < message.max_attempts
           and (
               message.locked_at is null
               or message.locked_at
                  < now() - make_interval(mins => v_lock_timeout)
           )
         order by message.scheduled_at asc, message.created_at asc
         for update skip locked
         limit 1
    )
    update public.lifeos_queue_messages as message
       set status = 'processing',
           locked_at = now(),
           lock_owner = p_worker_id,
           attempts = message.attempts + 1,
           last_error = null
      from candidate
     where message.id = candidate.id
    returning message.*;
end;
$$;

create or replace function public.lifeos_queue_mark_sent(
    p_message_id uuid,
    p_worker_id text,
    p_gmail_message_id text,
    p_gmail_thread_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_updated integer;
begin
    update public.lifeos_queue_messages
       set status = 'sent',
           sent_at = now(),
           gmail_message_id = nullif(trim(p_gmail_message_id), ''),
           gmail_thread_id = nullif(trim(p_gmail_thread_id), ''),
           locked_at = null,
           lock_owner = null,
           last_error = null
     where id = p_message_id
       and status = 'processing'
       and lock_owner = p_worker_id;

    get diagnostics v_updated = row_count;
    return v_updated = 1;
end;
$$;

create or replace function public.lifeos_queue_mark_failed(
    p_message_id uuid,
    p_worker_id text,
    p_error text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_updated integer;
begin
    update public.lifeos_queue_messages
       set status = case
               when attempts >= max_attempts then 'failed'
               else 'scheduled'
           end,
           scheduled_at = case
               when attempts >= max_attempts then scheduled_at
               else now() + interval '30 minutes'
           end,
           failed_at = case
               when attempts >= max_attempts then now()
               else failed_at
           end,
           locked_at = null,
           lock_owner = null,
           last_error = left(coalesce(p_error, 'Unknown delivery error'), 2000)
     where id = p_message_id
       and status = 'processing'
       and lock_owner = p_worker_id;

    get diagnostics v_updated = row_count;
    return v_updated = 1;
end;
$$;

alter table public.lifeos_queue_settings enable row level security;
alter table public.lifeos_queue_messages enable row level security;
alter table public.lifeos_queue_runs enable row level security;

revoke all on table
    public.lifeos_queue_settings,
    public.lifeos_queue_messages,
    public.lifeos_queue_runs
from anon, authenticated;

grant select, insert, update, delete on table
    public.lifeos_queue_settings,
    public.lifeos_queue_messages,
    public.lifeos_queue_runs
to service_role;

revoke all on function
    public.lifeos_queue_claim_next(text),
    public.lifeos_queue_mark_sent(uuid, text, text, text),
    public.lifeos_queue_mark_failed(uuid, text, text)
from public, anon, authenticated;

grant execute on function
    public.lifeos_queue_claim_next(text),
    public.lifeos_queue_mark_sent(uuid, text, text, text),
    public.lifeos_queue_mark_failed(uuid, text, text)
to service_role;

comment on table public.lifeos_queue_settings is
    'LifeOS Queue operating policy and activation state.';
comment on table public.lifeos_queue_messages is
    'LifeOS Queue outbound messages, inbound replies and delivery state.';
comment on table public.lifeos_queue_runs is
    'LifeOS Queue dispatcher and reply-synchronisation run history.';

commit;
