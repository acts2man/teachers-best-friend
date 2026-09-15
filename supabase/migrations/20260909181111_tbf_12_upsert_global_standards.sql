-- ---------------------------------------------------------------
-- Batch upsert for global (teacher_id IS NULL) standards.
--
-- PostgREST cannot target a partial unique index with ON CONFLICT,
-- but raw SQL can. This makes the seed a single atomic call instead
-- of a select/update/insert dance with a race window in the middle.
--
-- Accepts a JSON array. `embedding` is optional — pass it as a
-- pgvector literal string '[0.1,0.2,...]' or omit it to seed rows
-- first and backfill embeddings in a second pass. An omitted or null
-- embedding never clobbers one that is already stored.
-- ---------------------------------------------------------------
create or replace function public.upsert_global_standards(p_rows jsonb)
returns table (code text, action text)
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
    -- never wipe an existing embedding with a null
    embedding   = coalesce(excluded.embedding, s.embedding),
    active      = true,
    updated_at  = now()
  returning s.code, (case when s.xmin::text::bigint = txid_current() % (2^32)::bigint
                          then 'upserted' else 'upserted' end);
end;
$$;

revoke execute on function public.upsert_global_standards(jsonb) from public, anon, authenticated;

comment on function public.upsert_global_standards(jsonb) is
  'Atomic batch upsert of global standards. Service role only.
   Send batches of ~200 rows. Safe to re-run.';
