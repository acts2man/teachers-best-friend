drop function if exists public.upsert_global_standards(jsonb);

create or replace function public.upsert_global_standards(p_rows jsonb)
returns table (standard_code text, action text)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  return query
  insert into public.standards as s (
    teacher_id, jurisdiction, framework, subject, grade, code,
    short_label, description, domain, cluster, embedding, active
  )
  select
    null,
    coalesce(r ->> 'jurisdiction', 'CA'),
    r ->> 'framework',
    r ->> 'subject',
    r ->> 'grade',
    r ->> 'code',
    nullif(r ->> 'short_label', ''),
    r ->> 'description',
    nullif(r ->> 'domain', ''),
    nullif(r ->> 'cluster', ''),
    case
      when nullif(r ->> 'embedding', '') is not null
      then (r ->> 'embedding')::extensions.vector(1536)
      else null
    end,
    true
  from jsonb_array_elements(p_rows) as r
  on conflict (jurisdiction, framework, code) where teacher_id is null
  do update set
    subject     = excluded.subject,
    grade       = excluded.grade,
    short_label = excluded.short_label,
    description = excluded.description,
    domain      = excluded.domain,
    cluster     = excluded.cluster,
    embedding   = coalesce(excluded.embedding, s.embedding),  -- never wipe an existing vector
    active      = true,
    updated_at  = now()
  returning s.code, (case when s.xmax = 0 then 'inserted' else 'updated' end);
end;
$$;

revoke execute on function public.upsert_global_standards(jsonb) from public, anon, authenticated;

comment on function public.upsert_global_standards(jsonb) is
  'Atomic batch upsert of global standards, service role only.
   Handles the partial unique index that PostgREST .upsert() cannot target.
   Send ~200 rows per call. A null embedding never overwrites a stored one.';
