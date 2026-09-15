drop view public.admin_tickets;
create view public.admin_tickets as
select t.id,
       t.ticket_ref,
       t.subject,
       t.category,
       t.status,
       t.priority,
       t.deflected,
       t.ai_confidence,
       t.created_at,
       t.updated_at,
       t.resolved_at,
       u.email as teacher_email,
       p.full_name as teacher_name,
       t.teacher_id,
       sub.plan_id,
       pl.name as plan_name,
       pl.price_cents as plan_price_cents,
       (select count(*) from public.support_messages m where m.ticket_id = t.id) as message_count,
       (select m.body from public.support_messages m where m.ticket_id = t.id order by m.created_at desc limit 1) as last_message
from public.support_tickets t
join auth.users u on u.id = t.teacher_id
left join public.profiles p on p.id = t.teacher_id
left join public.subscriptions sub on sub.teacher_id = t.teacher_id
left join public.plans pl on pl.id = sub.plan_id;

