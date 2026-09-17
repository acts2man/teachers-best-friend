revoke execute on function public.can_open_support_ticket() from anon;
revoke execute on function public.open_support_ticket(text, text, text, text) from anon;
revoke execute on function public.reply_support_ticket(uuid, text) from anon;
revoke execute on function public.admin_set_ticket_priority(uuid, uuid, text) from anon;

