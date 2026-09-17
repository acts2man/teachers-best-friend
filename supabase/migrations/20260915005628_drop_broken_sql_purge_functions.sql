-- These two only ever raised "Direct deletion from storage tables is not
-- allowed" -- every nightly run since they were created failed. Deletion now
-- runs through the purge-expired-uploads edge function, which uses the
-- Storage API and therefore removes the file itself rather than orphaning it.
-- Dropping them so nothing can be pointed back at a path that cannot work.
drop function if exists public.purge_expired_uploads();
drop function if exists public.purge_expired_teacher_uploads();

