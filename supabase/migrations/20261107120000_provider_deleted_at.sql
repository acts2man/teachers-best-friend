-- Deleting the AI provider's stored copy of a background job (review of #203,
-- with the #212 review fixes).
--
-- A background analysis is sent with store:true so it can be read back; the
-- provider keeps it until we delete it. The poll route deletes it on every
-- outcome and stamps provider_deleted_at; a scheduled sweep
-- (public.scans_awaiting_provider_delete + app/api/cron/provider-sweep)
-- deletes whatever is still there once it is SAFE to -- the job is terminal in
-- our row, or old enough that it cannot still be running -- and stamps it too.
--
-- Additive and nullable: the synchronous path never sets these columns, and an
-- existing background row reads null until the sweep gets to it. Safe to apply
-- ahead of the code. NOT APPLIED by merging -- migrations here are applied by
-- hand.

set lock_timeout = '5s';

alter table public.scans
  add column if not exists provider_deleted_at timestamptz,
  -- How many times the sweep has tried and failed to delete this copy. A copy
  -- the provider keeps refusing to delete is skipped after a few tries so it
  -- never blocks newer jobs (#212 review e); the poll route and backfill can
  -- still clear it, and it is surfaced for a human.
  add column if not exists provider_delete_attempts smallint not null default 0;

comment on column public.scans.provider_deleted_at is
  'When the AI provider''s stored copy of this background job was deleted (review of #203). Null: never stored there (synchronous path), or not deleted yet.';
comment on column public.scans.provider_delete_attempts is
  'Failed sweep delete attempts for this provider copy; the sweep skips it after a few so one stuck job does not block others (#212 review).';

-- The sweep reads a stored, undeleted, not-yet-exhausted copy that it is safe
-- to delete, so a partial index keeps the lookup cheap as the table grows.
create index if not exists scans_awaiting_provider_delete
  on public.scans (created_at)
  where provider_response_id is not null
    and provider_deleted_at is null
    and provider_delete_attempts < 5;

-- How long a background job can still be running. Past this, a job that is not
-- terminal in our row is abandoned (the client gave up), never still producing
-- a result the app will collect, so its copy is safe to delete. OpenAI
-- background jobs finish in well under this; it is a conservative ceiling.
-- Keep in step with MAX_JOB_LIFETIME_MS in lib/provider-retention.ts.

-- The sweep's working set, oldest first. A row is returned only when deleting
-- its copy cannot destroy a result the app still needs (#212 review b):
--   * the job is terminal in our scans row (complete / failed / canceled) -- we
--     are done with it, the poll route just could not delete the copy; or
--   * it is older than the one-hour job lifetime, so it cannot still be running.
-- `cutoff` is a floor the caller passes (now - a few minutes) so a very fresh
-- job being actively polled is never touched. Returns ids only, never content.
-- Security definer so the service role can read it.
create or replace function public.scans_awaiting_provider_delete(cutoff timestamptz, max_rows int default 100)
returns table (id uuid, provider_response_id text)
language sql
security definer
set search_path = public
as $$
  select id, provider_response_id
  from public.scans
  where provider_response_id is not null
    and provider_deleted_at is null
    and provider_delete_attempts < 5
    and created_at < cutoff
    and (status in ('complete', 'failed', 'canceled')
         or created_at < now() - interval '1 hour')
  order by created_at
  limit greatest(1, least(max_rows, 1000));
$$;

revoke all on function public.scans_awaiting_provider_delete(timestamptz, int) from public, anon, authenticated;
grant execute on function public.scans_awaiting_provider_delete(timestamptz, int) to service_role;

-- Records a failed delete attempt (#212 review e), so a permanently failing
-- copy is skipped after a few tries instead of blocking the batch.
create or replace function public.note_provider_delete_failed(p_scan uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.scans
     set provider_delete_attempts = provider_delete_attempts + 1
   where id = p_scan;
$$;

revoke all on function public.note_provider_delete_failed(uuid) from public, anon, authenticated;
grant execute on function public.note_provider_delete_failed(uuid) to service_role;

-- Clearing a teacher's failed scans must not drop a scan whose provider copy
-- has not been deleted yet (#212 review f): that would strand the copy with no
-- row left for the sweep to find. Such rows are kept until the sweep clears
-- them, then a later clear removes them.
create or replace function public.admin_clear_failed_scans(p_actor uuid, p_teacher uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n int; v_cost numeric; v_errors jsonb;
begin
  if not public.is_admin(p_actor) then raise exception 'NOT_ADMIN'; end if;
  select count(*), coalesce(sum(cost_usd), 0), coalesce(jsonb_agg(distinct left(error, 140)), '[]'::jsonb)
    into v_n, v_cost, v_errors
    from public.scans
   where teacher_id = p_teacher and status in ('failed', 'canceled')
     and not (provider_response_id is not null and provider_deleted_at is null);
  delete from public.scans
   where teacher_id = p_teacher and status in ('failed', 'canceled')
     and not (provider_response_id is not null and provider_deleted_at is null);
  perform public.admin_log(p_actor, 'clear_failed_scans', 'teacher', p_teacher::text,
    jsonb_build_object('removed', v_n, 'cost_usd', v_cost, 'errors', v_errors));
  return v_n;
end $$;
revoke all on function public.admin_clear_failed_scans(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_clear_failed_scans(uuid, uuid) to service_role;
