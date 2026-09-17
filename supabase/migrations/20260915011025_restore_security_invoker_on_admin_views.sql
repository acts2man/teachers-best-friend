-- A concurrent session hardened the admin views with security_invoker. My
-- later CREATE OR REPLACE of these two, to correct their storage figures,
-- dropped that option, because replacing a view does not carry its reloptions
-- forward. Restore it so all six admin views match again.
--
-- Access is unaffected either way: anon and authenticated already have no
-- select privilege on these, and the admin pages read them through the
-- service role.
alter view public.admin_accounts set (security_invoker = on);
alter view public.admin_platform_stats set (security_invoker = on);

