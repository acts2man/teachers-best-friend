-- Audit fixes, part 1: close the admin-view exposure and open public pricing.
--
-- 1. public.admin_tickets was a SECURITY DEFINER view with SELECT granted to
--    anon. It joins auth.users and has no admin predicate of its own, so any
--    holder of the publishable key could have listed every support ticket,
--    its last message body, and the teacher's email. It returned nothing only
--    because no ticket had been filed yet.
--
--    Every admin_* view is read exclusively by the service-role client
--    (lib/supabase-admin.ts), never by a browser session, so the fix is to
--    take them out of the PostgREST-reachable surface entirely and switch
--    them to security_invoker so a future grant cannot resurrect the leak.
--
-- 2. plans_read was granted TO authenticated only, so the marketing page's
--    anon-key query returned nothing and silently fell back to a hardcoded
--    price list that has since drifted from this table. Pricing is public
--    information; let anon read the active rows.
--
-- 3. guard_profile_self_update() is a trigger function that kept the default
--    PUBLIC execute grant, leaving it callable over /rest/v1/rpc. Revoke it,
--    as tbf_08 already did for every other internal function.

------------------------------------------------------------------ 1. views
alter view public.admin_accounts            set (security_invoker = on);
alter view public.admin_cost_breakdown      set (security_invoker = on);
alter view public.admin_daily_usage         set (security_invoker = on);
alter view public.admin_model_costs         set (security_invoker = on);
alter view public.admin_platform_stats      set (security_invoker = on);
alter view public.admin_reteaching          set (security_invoker = on);
alter view public.admin_standards_coverage  set (security_invoker = on);
alter view public.admin_tickets             set (security_invoker = on);

revoke all on public.admin_accounts           from anon, authenticated;
revoke all on public.admin_cost_breakdown     from anon, authenticated;
revoke all on public.admin_daily_usage        from anon, authenticated;
revoke all on public.admin_model_costs        from anon, authenticated;
revoke all on public.admin_platform_stats     from anon, authenticated;
revoke all on public.admin_reteaching         from anon, authenticated;
revoke all on public.admin_standards_coverage from anon, authenticated;
revoke all on public.admin_tickets            from anon, authenticated;
revoke all on public.teacher_unit_economics   from anon, authenticated;

-- Service-role-only tables. RLS already blocks the roles below (no policies
-- exist for them); removing the blanket grants means a future policy added
-- for an unrelated reason cannot expose them by accident.
revoke all on public.admin_audit_log          from anon, authenticated;
revoke all on public.impersonation_sessions   from anon, authenticated;
revoke all on public.pipeline_config          from anon, authenticated;
revoke all on public.model_pricing            from anon, authenticated;
revoke all on public.demo_templates           from anon, authenticated;

------------------------------------------------------------------ 2. pricing
drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans
  for select to anon, authenticated
  using (active);

------------------------------------------------------------------ 3. function
revoke all on function public.guard_profile_self_update() from public, anon, authenticated;

