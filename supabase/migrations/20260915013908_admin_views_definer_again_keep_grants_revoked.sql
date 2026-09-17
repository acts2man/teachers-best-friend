-- Regression fix: the admin dashboard returned a server error on every page.
--
-- The security lockdown did two things: it REVOKED the admin views from anon
-- and authenticated (which is what actually closed the exposure), and it set
-- security_invoker = on (belt and braces). The second one broke them.
--
-- These views join auth.users. Running as the view owner they could read it;
-- running as the invoker they cannot, because service_role has no SELECT on
-- auth.users:
--
--   ERROR: 42501: permission denied for table users
--
-- and lib/supabase-admin.ts reads every one of them through the service role.
-- So /admin, /admin/accounts and /admin/tickets all 500'd.
--
-- Granting service_role SELECT on auth.users would fix it too, but that hands
-- a broadly-used role standing access to the whole auth table for the sake of
-- two columns. Reverting to definer is the smaller change: the views can read
-- what they were written to read, and the revoked grants still mean no browser
-- role can reach them at all. Verified after this migration: anon and
-- authenticated have no privilege on any admin_* view.
--
-- teacher_unit_economics stays security_invoker: it never touched auth.users,
-- and it is deliberately RLS-scoped to the caller.

alter view public.admin_accounts            set (security_invoker = off);
alter view public.admin_cost_breakdown      set (security_invoker = off);
alter view public.admin_daily_usage         set (security_invoker = off);
alter view public.admin_model_costs         set (security_invoker = off);
alter view public.admin_platform_stats      set (security_invoker = off);
alter view public.admin_reteaching          set (security_invoker = off);
alter view public.admin_standards_coverage  set (security_invoker = off);
alter view public.admin_tickets             set (security_invoker = off);

-- Re-assert the revokes: these are the control that matters, and a
-- CREATE OR REPLACE VIEW from any session can restore default grants.
revoke all on public.admin_accounts           from anon, authenticated;
revoke all on public.admin_cost_breakdown     from anon, authenticated;
revoke all on public.admin_daily_usage        from anon, authenticated;
revoke all on public.admin_model_costs        from anon, authenticated;
revoke all on public.admin_platform_stats     from anon, authenticated;
revoke all on public.admin_reteaching         from anon, authenticated;
revoke all on public.admin_standards_coverage from anon, authenticated;
revoke all on public.admin_tickets            from anon, authenticated;

