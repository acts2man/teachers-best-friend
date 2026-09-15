-- Enable RLS everywhere
alter table public.plans                 enable row level security;
alter table public.profiles              enable row level security;
alter table public.subscriptions         enable row level security;
alter table public.standards             enable row level security;
alter table public.reteaching_library    enable row level security;
alter table public.classes               enable row level security;
alter table public.students              enable row level security;
alter table public.student_groups        enable row level security;
alter table public.student_group_members enable row level security;
alter table public.assessments           enable row level security;
alter table public.assessment_standards  enable row level security;
alter table public.lessons               enable row level security;
alter table public.resources             enable row level security;
alter table public.uploads               enable row level security;
alter table public.scans                 enable row level security;
alter table public.scan_items            enable row level security;

-- ---------------- reference data: read-only to users ----------------
create policy plans_read on public.plans
  for select to authenticated using (active);

-- reteaching library is SHARED READ, service-role write only.
-- No insert/update/delete policies: only the service key can write.
create policy reteaching_read on public.reteaching_library
  for select to authenticated using (review_status <> 'retired');

-- ---------------- profiles & subscriptions ----------------
create policy profiles_own_select on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_own_update on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Subscription is readable but NOT writable by the teacher:
-- plan changes must go through Stripe webhooks on the service role.
create policy subscriptions_own_select on public.subscriptions
  for select to authenticated using (teacher_id = (select auth.uid()));

-- ---------------- standards: global read + own custom write ----------------
create policy standards_read on public.standards
  for select to authenticated
  using (teacher_id is null or teacher_id = (select auth.uid()));

create policy standards_own_insert on public.standards
  for insert to authenticated with check (teacher_id = (select auth.uid()));
create policy standards_own_update on public.standards
  for update to authenticated
  using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));
create policy standards_own_delete on public.standards
  for delete to authenticated using (teacher_id = (select auth.uid()));

-- ---------------- tenant-owned tables ----------------
do $$
declare t text;
begin
  foreach t in array array[
    'classes','students','student_groups','student_group_members',
    'assessments','assessment_standards','lessons','resources',
    'uploads','scan_items'
  ]
  loop
    execute format($f$
      create policy %1$s_own_select on public.%1$s
        for select to authenticated using (teacher_id = (select auth.uid()));
      create policy %1$s_own_insert on public.%1$s
        for insert to authenticated with check (teacher_id = (select auth.uid()));
      create policy %1$s_own_update on public.%1$s
        for update to authenticated
        using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));
      create policy %1$s_own_delete on public.%1$s
        for delete to authenticated using (teacher_id = (select auth.uid()));
    $f$, t);
  end loop;
end $$;

-- ---------------- scans: readable/creatable by owner, but the
-- billing and cost columns are service-role only (see trigger below) ----------------
create policy scans_own_select on public.scans
  for select to authenticated using (teacher_id = (select auth.uid()));
create policy scans_own_insert on public.scans
  for insert to authenticated with check (teacher_id = (select auth.uid()));
create policy scans_own_delete on public.scans
  for delete to authenticated using (teacher_id = (select auth.uid()));

-- Deliberately NO update policy for authenticated on public.scans:
-- token counts, cost_usd, status and billable are written by the
-- edge function using the service role. A client that can edit its own
-- meter is not a meter.

-- ---------------- guard: clients cannot forge billing fields ----------------
create or replace function public.guard_scan_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only applies to requests carrying an end-user JWT. The service role
  -- (auth.uid() IS NULL) writes real values from the edge function.
  if auth.uid() is not null then
    new.billable       := true;
    new.billing_period := date_trunc('month', now())::date;
    new.status         := 'queued';
    new.cost_usd       := 0;
    new.extract_model  := null;
    new.reteach_model  := null;
    new.extract_input_tokens        := 0;
    new.extract_cached_input_tokens := 0;
    new.extract_output_tokens       := 0;
    new.reteach_input_tokens        := 0;
    new.reteach_cached_input_tokens := 0;
    new.reteach_output_tokens       := 0;
    new.library_hits   := 0;
    new.library_misses := 0;
    new.completed_at   := null;
  end if;
  return new;
end;
$$;

create trigger scans_guard_insert
  before insert on public.scans
  for each row execute function public.guard_scan_insert();

-- ---------------- guard: enforce the quota at the database ----------------
create or replace function public.enforce_scan_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quota integer;
  v_used  integer;
begin
  if auth.uid() is null then
    return new;  -- service role bypasses
  end if;

  select p.scan_quota into v_quota
    from public.subscriptions sub
    join public.plans p on p.id = sub.plan_id
   where sub.teacher_id = new.teacher_id;

  if v_quota is null then
    raise exception 'No active subscription for teacher %', new.teacher_id;
  end if;

  v_used := public.current_period_scan_count(new.teacher_id);

  if v_used >= v_quota then
    raise exception 'SCAN_QUOTA_EXCEEDED: % of % scans used this period', v_used, v_quota
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger scans_enforce_quota
  before insert on public.scans
  for each row execute function public.enforce_scan_quota();
