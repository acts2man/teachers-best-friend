-- After 20261014120000_photo_retention_14_days.sql: every student photo is
-- kept 14 days from upload, no longer.
--
-- Safe to run against production: read-only. Run it right after applying the
-- migration, and again after the next 09:00 UTC purge: the second run's
-- "due_now" should be back to 0 (or only what reached 14 days since).

-- Reporting first.
select t, default_expiry, live, due_now, kept_longer_than_14d
from (
  select 'teacher_uploads' as t,
         (select column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'teacher_uploads' and column_name = 'expires_at') as default_expiry,
         count(*) filter (where purged_at is null) as live,
         count(*) filter (where purged_at is null and expires_at <= now()) as due_now,
         count(*) filter (where purged_at is null and expires_at > created_at + interval '14 days') as kept_longer_than_14d
    from public.teacher_uploads
  union all
  select 'uploads',
         (select column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'uploads' and column_name = 'expires_at'),
         count(*) filter (where purged_at is null),
         count(*) filter (where purged_at is null and expires_at <= now()),
         count(*) filter (where purged_at is null and expires_at > created_at + interval '14 days')
    from public.uploads
) x;

-- Assertion.
do $$
declare
  bad bigint;
  d   text;
begin
  for d in
    select column_default from information_schema.columns
     where table_schema = 'public' and table_name in ('teacher_uploads', 'uploads') and column_name = 'expires_at'
  loop
    if d is distinct from '(now() + ''14 days''::interval)' then
      raise exception 'expires_at default is %, expected 14 days', d;
    end if;
  end loop;

  select (select count(*) from public.teacher_uploads where purged_at is null and expires_at > created_at + interval '14 days')
       + (select count(*) from public.uploads where purged_at is null and expires_at > created_at + interval '14 days')
    into bad;
  if bad > 0 then
    raise exception '% live upload(s) are still set to be kept longer than 14 days', bad;
  end if;
  raise notice 'ok: both defaults are 14 days and no live upload outlives 14 days';
end $$;
