-- New functions get PUBLIC execute by default; match this app's existing
-- posture (my_scan_quota: authenticated only, public/anon revoked;
-- admin_reply_ticket: no client grants at all, service-role only).
revoke execute on function public.can_open_support_ticket() from public;
revoke execute on function public.open_support_ticket(text, text, text, text) from public;
revoke execute on function public.reply_support_ticket(uuid, text) from public;
revoke execute on function public.admin_set_ticket_priority(uuid, uuid, text) from public;
revoke execute on function public.admin_set_ticket_priority(uuid, uuid, text) from authenticated;

