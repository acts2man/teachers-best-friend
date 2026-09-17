-- Postgres grants EXECUTE to PUBLIC on every new function, and anon /
-- authenticated inherit it. Revoking from those roles alone is a no-op.
-- Revoke from PUBLIC, then grant back only what the client legitimately needs.

revoke execute on function public.handle_new_user()               from public, anon, authenticated;
revoke execute on function public.touch_updated_at()              from public, anon, authenticated;
revoke execute on function public.assign_ticket_ref()             from public, anon, authenticated;
revoke execute on function public.guard_scan_insert()             from public, anon, authenticated;
revoke execute on function public.enforce_scan_quota()            from public, anon, authenticated;
revoke execute on function public.compute_scan_cost()             from public, anon, authenticated;
revoke execute on function public.purge_expired_uploads()         from public, anon, authenticated;
revoke execute on function public.purge_expired_student_notes()   from public, anon, authenticated;
revoke execute on function public.record_reteaching_hit(uuid)     from public, anon, authenticated;
revoke execute on function public.current_period_scan_count(uuid) from public, anon, authenticated;
revoke execute on function public.scan_quota_status(uuid)         from public, anon, authenticated;
revoke execute on function public.my_scan_quota()                 from public, anon;

-- The one function the browser is allowed to call. It takes no argument,
-- so a client cannot ask about another teacher's usage.
grant execute on function public.my_scan_quota() to authenticated;

-- Belt and braces: new functions in this schema should not be world-callable.
alter default privileges in schema public revoke execute on functions from public;
