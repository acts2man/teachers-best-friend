-- ===============================================================
-- PIPELINE RPCs
-- Called from the Next.js route handler with the SERVICE ROLE key.
-- None of these are exposed to the browser.
-- ===============================================================

-- 1. STANDARDS RETRIEVAL (replaces sending the whole catalog)
-- Embedding model: text-embedding-3-small (1536 dims).
create or replace function public.match_standards(
  p_embedding    extensions.vector(1536),
  p_jurisdiction text default 'CA',
  p_grade        text default null,
  p_subject      text default null,
  p_framework    text default null,
  p_teacher      uuid default null,
  p_limit        integer default 10
)
returns table (
  id uuid, code text, short_label text, description text,
  domain text, cluster text, similarity double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select s.id, s.code, s.short_label, s.description, s.domain, s.cluster,
         (1 - (s.embedding <=> p_embedding))::double precision
    from public.standards s
   where s.active
     and s.embedding is not null
     and (s.teacher_id is null or s.teacher_id = p_teacher)
     and (p_jurisdiction is null or s.jurisdiction = p_jurisdiction)
     and (p_grade        is null or s.grade       = p_grade)
     and (p_subject      is null or s.subject     = p_subject)
     and (p_framework    is null or s.framework   = p_framework)
   order by s.embedding <=> p_embedding
   limit greatest(p_limit, 1);
$$;

-- 2. RETEACHING CACHE — READ. Call BEFORE generating. A hit costs zero tokens.
create or replace function public.get_reteaching(
  p_standard_id       uuid,
  p_error_pattern_key text,
  p_grade_band        text default ''
)
returns table (id uuid, title text, content jsonb)
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  return query
  update public.reteaching_library r
     set times_served = r.times_served + 1,
         updated_at   = now()
   where r.standard_id       = p_standard_id
     and r.error_pattern_key = p_error_pattern_key
     and r.grade_band        = coalesce(p_grade_band, '')
     and r.review_status <> 'retired'
  returning r.id, r.title, r.content;
end;
$$;

-- 3. RETEACHING CACHE — WRITE (only on a miss)
create or replace function public.upsert_reteaching(
  p_standard_id       uuid,
  p_error_pattern_key text,
  p_error_label       text,
  p_title             text,
  p_content           jsonb,
  p_grade_band        text default '',
  p_model             text default null,
  p_cost_usd          numeric default 0
)
returns uuid
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.reteaching_library
    (standard_id, error_pattern_key, error_pattern_label, grade_band,
     title, content, model, generation_cost_usd)
  values
    (p_standard_id, p_error_pattern_key, p_error_label, coalesce(p_grade_band,''),
     p_title, p_content, p_model, coalesce(p_cost_usd, 0))
  on conflict (standard_id, error_pattern_key, grade_band)
  do update set content = excluded.content, updated_at = now()
  returning id;
$$;

-- 4. START A SCAN. Service role bypasses the RLS quota trigger,
-- so the quota is enforced explicitly here. Catch SCAN_QUOTA_EXCEEDED -> HTTP 402.
create or replace function public.create_scan(
  p_teacher       uuid,
  p_class_id      uuid default null,
  p_student_id    uuid default null,
  p_assessment_id uuid default null,
  p_upload_id     uuid default null,
  p_billable      boolean default true
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_quota integer;
  v_used  integer;
  v_id    uuid;
begin
  if p_billable then
    select p.scan_quota into v_quota
      from public.subscriptions sub
      join public.plans p on p.id = sub.plan_id
     where sub.teacher_id = p_teacher;

    if v_quota is null then
      raise exception 'NO_SUBSCRIPTION: teacher %', p_teacher using errcode = 'check_violation';
    end if;

    v_used := public.current_period_scan_count(p_teacher);

    if v_used >= v_quota then
      raise exception 'SCAN_QUOTA_EXCEEDED: % of % used', v_used, v_quota
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.scans
    (teacher_id, class_id, student_id, assessment_id, upload_id, billable, status)
  values
    (p_teacher, p_class_id, p_student_id, p_assessment_id, p_upload_id, p_billable, 'queued')
  returning id into v_id;

  return v_id;
end;
$$;

-- 5. RECORD USAGE. cost_usd is computed by trigger from model_pricing —
-- never pass a cost in from the app.
create or replace function public.record_scan_usage(
  p_scan_id            uuid,
  p_status             text default 'complete',
  p_extract_model      text default null,
  p_extract_in         integer default 0,
  p_extract_cached_in  integer default 0,
  p_extract_out        integer default 0,
  p_reteach_model      text default null,
  p_reteach_in         integer default 0,
  p_reteach_cached_in  integer default 0,
  p_reteach_out        integer default 0,
  p_library_hits       integer default 0,
  p_library_misses     integer default 0,
  p_error              text default null
)
returns numeric
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_cost numeric;
begin
  update public.scans set
    status                      = p_status::public.scan_status,
    extract_model               = coalesce(p_extract_model, extract_model),
    extract_input_tokens        = coalesce(p_extract_in, 0),
    extract_cached_input_tokens = coalesce(p_extract_cached_in, 0),
    extract_output_tokens       = coalesce(p_extract_out, 0),
    reteach_model               = coalesce(p_reteach_model, reteach_model),
    reteach_input_tokens        = coalesce(p_reteach_in, 0),
    reteach_cached_input_tokens = coalesce(p_reteach_cached_in, 0),
    reteach_output_tokens       = coalesce(p_reteach_out, 0),
    library_hits                = coalesce(p_library_hits, 0),
    library_misses              = coalesce(p_library_misses, 0),
    error                       = p_error,
    completed_at                = case when p_status in ('complete','failed','canceled') then now() end
  where id = p_scan_id
  returning cost_usd into v_cost;

  return v_cost;
end;
$$;

-- Service role only. Nothing here is browser-callable.
revoke execute on function public.match_standards(extensions.vector,text,text,text,text,uuid,integer) from public, anon, authenticated;
revoke execute on function public.get_reteaching(uuid,text,text)                                       from public, anon, authenticated;
revoke execute on function public.upsert_reteaching(uuid,text,text,text,jsonb,text,text,numeric)       from public, anon, authenticated;
revoke execute on function public.create_scan(uuid,uuid,uuid,uuid,uuid,boolean)                        from public, anon, authenticated;
revoke execute on function public.record_scan_usage(uuid,text,text,integer,integer,integer,text,integer,integer,integer,integer,integer,text) from public, anon, authenticated;
