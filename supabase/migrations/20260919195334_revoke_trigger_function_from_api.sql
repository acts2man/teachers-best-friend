-- block_write_while_impersonating() is a trigger function. Postgres calls it
-- itself on the tables that install it; nothing needs to call it by name, and
-- being SECURITY DEFINER it ran with the definer's rights for anyone who
-- reached it through /rest/v1/rpc. Trigger functions are still invoked normally
-- after EXECUTE is revoked, so this costs nothing and closes the route.
revoke execute on function public.block_write_while_impersonating() from public, anon, authenticated;
