-- Shared standards keep the teacher-facing extras the catalog lookup returns
-- (skills, DOK, misconception, example, source) so the next teacher gets the
-- same library entry without another AI call.
alter table public.standards add column if not exists meta jsonb;
comment on column public.standards.meta is 'Extras from the catalog lookup: skills[], dok, misconception, example, source';

create or replace function public.upsert_global_standards(p_rows jsonb)
returns table(standard_code text, action text)
language plpgsql security definer set search_path = public, extensions as $$
begin
  return query
  insert into public.standards as s (
    teacher_id, jurisdiction, framework, subject, grade, code,
    short_label, description, domain, cluster, embedding, meta, active
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
    case when nullif(r ->> 'embedding', '') is not null then (r ->> 'embedding')::extensions.vector(1536) else null end,
    case when jsonb_typeof(r -> 'meta') = 'object' then r -> 'meta' else null end,
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
    embedding   = coalesce(excluded.embedding, s.embedding),
    meta        = coalesce(excluded.meta, s.meta),
    active      = true,
    updated_at  = now()
  returning s.code, (case when s.xmax = 0 then 'inserted' else 'updated' end);
end;
$$;
