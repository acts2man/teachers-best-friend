-- Teacher-facing support ticketing: eligibility gate, create/reply RPCs,
-- an admin priority-only update, and realtime for live threads.

-- Eligible = admin (always, for testing/self-support), or an active
-- subscription that is either the comped beta plan or an actually paying
-- plan (price_cents > 0). Free stays excluded.
create or replace function public.can_open_support_ticket()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_admin(auth.uid())
    or exists (
      select 1
      from public.subscriptions sub
      join public.plans p on p.id = sub.plan_id
      where sub.teacher_id = auth.uid()
        and sub.status = 'active'
        and (sub.plan_id = 'beta' or p.price_cents > 0)
    ),
    false
  );
$$;
grant execute on function public.can_open_support_ticket() to authenticated;

-- Tighten the existing insert policy so a raw table insert is gated too,
-- not just the RPC below (defense in depth against bypassing the RPC).
drop policy if exists tickets_own_insert on public.support_tickets;
create policy tickets_own_insert on public.support_tickets for insert to authenticated
  with check (teacher_id = auth.uid() and public.can_open_support_ticket());

-- Open a new ticket + its opening message in one call. The client always
-- calls this rather than inserting the rows directly, so validation and
-- the priority clamp stay in one place.
create or replace function public.open_support_ticket(
  p_subject text,
  p_body text,
  p_category text default null,
  p_priority text default 'normal'
)
returns table(id uuid, ticket_ref text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_ref text;
  v_subject text := trim(coalesce(p_subject, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_priority text := case when p_priority in ('low','normal','high') then p_priority else 'normal' end;
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN' using errcode = '28000';
  end if;
  if not public.can_open_support_ticket() then
    raise exception 'NOT_ELIGIBLE' using errcode = '42501';
  end if;
  if char_length(v_subject) < 1 or char_length(v_subject) > 200 then
    raise exception 'INVALID_SUBJECT' using errcode = '22023';
  end if;
  if char_length(v_body) < 1 then
    raise exception 'INVALID_BODY' using errcode = '22023';
  end if;

  insert into public.support_tickets (teacher_id, subject, category, priority, body)
  values (auth.uid(), v_subject, nullif(trim(coalesce(p_category, '')), ''), v_priority, v_body)
  returning support_tickets.id, support_tickets.ticket_ref into v_id, v_ref;

  insert into public.support_messages (ticket_id, teacher_id, author, body)
  values (v_id, auth.uid(), 'teacher', v_body);

  return query select v_id, v_ref;
end;
$$;
grant execute on function public.open_support_ticket(text, text, text, text) to authenticated;

-- Reply to a ticket you own. Once a ticket exists you can keep talking on
-- it even if you're no longer paying/beta -- only *opening a new one* is
-- gated. Replying reopens a resolved/AI-answered ticket automatically.
create or replace function public.reply_support_ticket(p_ticket uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_teacher uuid;
  v_status text;
  v_body text := trim(coalesce(p_body, ''));
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN' using errcode = '28000';
  end if;
  select teacher_id, status into v_teacher, v_status
    from public.support_tickets where id = p_ticket;
  if v_teacher is null or v_teacher <> auth.uid() then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status = 'closed' then
    raise exception 'TICKET_CLOSED' using errcode = '55000';
  end if;
  if char_length(v_body) < 1 then
    raise exception 'INVALID_BODY' using errcode = '22023';
  end if;

  insert into public.support_messages (ticket_id, teacher_id, author, body)
  values (p_ticket, auth.uid(), 'teacher', v_body);

  update public.support_tickets
     set status = case when status in ('resolved','ai_answered') then 'open' else status end
   where id = p_ticket;
end;
$$;
grant execute on function public.reply_support_ticket(uuid, text) to authenticated;

-- Admin: change priority alone, no reply required. Mirrors admin_reply_ticket's audit trail.
create or replace function public.admin_set_ticket_priority(p_actor uuid, p_ticket uuid, p_priority text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(p_actor) then raise exception 'NOT_ADMIN'; end if;
  if p_priority not in ('low','normal','high','urgent') then
    raise exception 'INVALID_PRIORITY';
  end if;
  update public.support_tickets set priority = p_priority where id = p_ticket;
  perform public.admin_log(p_actor, 'set_ticket_priority', 'ticket', p_ticket::text, jsonb_build_object('priority', p_priority));
end;
$$;
grant execute on function public.admin_set_ticket_priority(uuid, uuid, text) to authenticated;

-- Live threads: let both the teacher's ticket view and the admin queue
-- react instantly to a new message or a status/priority change.
alter publication supabase_realtime add table public.support_messages;
alter publication supabase_realtime add table public.support_tickets;

