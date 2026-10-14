set lock_timeout = '5s';

-- Student work photos are kept 14 days after upload, then deleted (decided by
-- both pilot founders, 14 Oct 2026; it was 30). This is now the only rule:
-- confirming a student's grading no longer deletes anything early, so every
-- photo follows the same 14-day clock whichever screen confirmed it.
--
-- The purge (edge function purge-expired-uploads, daily 09:00 UTC) deletes
-- every row whose expires_at has passed, so nothing about the function
-- changes: new rows get a 14-day default, and live rows are pulled in to 14
-- days after they were uploaded. Rows already older than that go at the next
-- run after this is applied.
--
-- Only ever shortens: a row already due sooner keeps its date, and purged rows
-- are left alone.

alter table public.teacher_uploads
  alter column expires_at set default (now() + interval '14 days');

update public.teacher_uploads
   set expires_at = created_at + interval '14 days'
 where purged_at is null
   and expires_at > created_at + interval '14 days';

-- The older table the app no longer writes to. Its eight live rows were given
-- 90 days when they were written; they get the same 14.
alter table public.uploads
  alter column expires_at set default (now() + interval '14 days');

update public.uploads
   set expires_at = created_at + interval '14 days'
 where purged_at is null
   and expires_at > created_at + interval '14 days';

comment on column public.teacher_uploads.expires_at is
  'When the purge deletes this photo: 14 days after upload. Nothing deletes it earlier except deleting the assessment or the account.';
