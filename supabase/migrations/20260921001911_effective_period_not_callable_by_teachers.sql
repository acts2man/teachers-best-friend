-- effective_period takes a teacher id and runs as definer, so granting it to
-- `authenticated` exposed /rest/v1/rpc/effective_period as a way to read any
-- other teacher's billing window by passing their uuid. Nothing in the app
-- calls it directly -- current_period_scan_count does, and that is itself
-- SECURITY DEFINER, so it keeps working with the grant gone.
revoke execute on function public.effective_period(uuid) from authenticated;
