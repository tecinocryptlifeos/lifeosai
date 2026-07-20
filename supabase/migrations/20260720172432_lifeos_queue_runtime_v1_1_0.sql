-- LIFEOS_QUEUE_RUNTIME_V1_1_0
-- Supabase migration version: 20260720172432
-- Serialize claims and enforce global outbound spacing across deployments.

begin;

create index if not exists lifeos_queue_messages_parent_idx
on public.lifeos_queue_messages (parent_message_id)
where parent_message_id is not null;

create index if not exists lifeos_queue_messages_created_by_idx
on public.lifeos_queue_messages (created_by)
where created_by is not null;

create or replace function public.lifeos_queue_claim_next(p_worker_id text)
returns setof public.lifeos_queue_messages
language plpgsql
security definer
set search_path = public
as $$
declare
    v_enabled boolean;
    v_daily_limit integer;
    v_send_interval integer;
    v_lock_timeout integer;
    v_sent_today integer;
    v_last_sent_at timestamptz;
    v_active_claims integer;
begin
    if nullif(trim(p_worker_id), '') is null then
        raise exception 'LifeOS Queue worker ID is required';
    end if;

    -- A transaction-level lock prevents two Render instances from claiming at
    -- the same instant during a zero-downtime deployment.
    perform pg_advisory_xact_lock(549804971234567890);

    select enabled,
           daily_send_limit,
           send_interval_minutes,
           lock_timeout_minutes
      into v_enabled,
           v_daily_limit,
           v_send_interval,
           v_lock_timeout
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

    select max(sent_at)
      into v_last_sent_at
      from public.lifeos_queue_messages
     where direction = 'outbound'
       and sent_at is not null;

    if v_last_sent_at is not null
       and v_last_sent_at > now() - make_interval(mins => v_send_interval) then
        return;
    end if;

    -- The Gmail request happens after the claim transaction commits. Keep a
    -- fresh processing lock as a reservation so another instance cannot claim
    -- a second message before the first one is marked sent or failed.
    select count(*)
      into v_active_claims
      from public.lifeos_queue_messages
     where direction = 'outbound'
       and status = 'processing'
       and locked_at >= now() - make_interval(mins => v_lock_timeout);

    if v_active_claims > 0 then
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

revoke all on function public.lifeos_queue_claim_next(text)
from public, anon, authenticated;

grant execute on function public.lifeos_queue_claim_next(text)
to service_role;

comment on function public.lifeos_queue_claim_next(text) is
    'Claims one due LifeOS Queue message with daily, spacing and concurrency guards.';

commit;
