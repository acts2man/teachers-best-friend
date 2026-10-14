-- Custom standards: one row per framework, and the teacher's extras survive a
-- reload. Fixes docs/system-map.md gaps G8 and G11. NOT applied by the author
-- -- apply by hand, then run supabase/checks/custom-standards-round-trip.sql.
--
-- G8 (rule R14). A teacher's custom standards were unique on (teacher_id,
-- code) and sync_workspace upserted them `on conflict (teacher_id, code)`. The
-- catalog loader keeps a standard per framework + grade + subject + code, so a
-- teacher who loads California AND Common Core (both use e.g. 3.OA.A.1) sends
-- two rows with one code, Postgres raises "ON CONFLICT DO UPDATE command
-- cannot affect row a second time", and EVERY save fails from then on.
--
-- The identity of a custom standard is now (teacher_id, framework, grade,
-- subject, code) -- exactly the key the catalog loader de-duplicates on
-- (components/teacher-classes.tsx), and a superset of the Standards > Add check
-- (framework + grade + code), so neither client path can send two rows for it.
-- All four columns are NOT NULL in public.standards, so a plain column index
-- needs no coalesce. Existing rows are unique on (teacher_id, code), so they are
-- unique on the wider key too: the new index cannot fail to build.
--
-- RULE R9 EXCEPTION (the only DROP in this file, allow-listed by name in
-- tests/invariants/migration-safety.test.mjs): the old unique index
-- custom_standards_key on (teacher_id, code) would still reject the second
-- row, and Postgres has no way to make a unique index non-unique except to
-- drop it. Dropping an INDEX loses no data and is re-creatable; the
-- alternatives were worse: keeping one row per code silently deletes a
-- framework's standard (data loss), rewriting `code` to carry the framework
-- breaks every question's standard_code link, and editing pg_index is a
-- catalog hack that needs superuser. Order matters and is all in this one
-- transaction: build the new unique index, re-point the function at it, THEN
-- drop the old one -- so at no moment is the function's ON CONFLICT target
-- missing, and at no moment are teacher rows unconstrained.
--
-- G11 (rule R2). sync_workspace kept only code/title/subject/grade/domain/
-- cluster/wording-or-summary/framework; skills, prerequisites, next,
-- vocabulary, misconception, example, dok, source and officialCode were
-- dropped and get_workspace_json refilled them from the shared catalog or a
-- default. They now go into the row's existing `meta` jsonb column (the same
-- column the shared catalog uses, so no new column), and get_workspace_json
-- reads prerequisites/next/vocabulary/officialCode from meta too instead of
-- hard-coding '[]'. An all-empty meta is stored as NULL so the shared-catalog
-- fallback still applies. Every value is type-checked (arrays only, safe_int
-- for dok), so no value a save sends can fail it (R13).
--
-- Also: a payload that somehow holds two rows for the SAME new key keeps the
-- last one instead of failing the save (R14), and the delete of custom
-- standards the teacher no longer has matches on the full key, not the code.
--
-- How (same as 20261013130000): read the LIVE definition with
-- pg_get_functiondef, replace exactly these fragments, and stop with an error
-- naming the fragment if any is not found exactly once. Fragments are code
-- only: the live bodies carry no comments (checked read-only on production,
-- 14 Oct 2026; sync_workspace md5 107ada86..., get_workspace_json md5
-- eb1bfac3..., every fragment below found exactly once in the bodies that
-- tests/invariants/lib/workspace-sql.mjs rebuilds from this directory).

set lock_timeout = '5s';

create unique index if not exists custom_standards_identity_key
  on public.standards (teacher_id, framework, grade, subject, code)
  where teacher_id is not null;

do $patch$
declare
  def text;
  -- [function, fragment, replacement]
  edits text[][] := array[
    array['sync_workspace',
      'insert into public.standards (teacher_id, jurisdiction, framework, subject, grade, code, short_label, description, domain, cluster)',
      'insert into public.standards (teacher_id, jurisdiction, framework, subject, grade, code, short_label, description, domain, cluster, meta)'],
    array['sync_workspace',
      'nullif(cs->>''domain'',''''), nullif(cs->>''cluster'','''')',
      'nullif(cs->>''domain'',''''), nullif(cs->>''cluster'',''''),
         nullif(jsonb_strip_nulls(jsonb_build_object(
           ''skills'', case when jsonb_typeof(cs->''skills'') = ''array'' then cs->''skills'' end,
           ''prerequisites'', case when jsonb_typeof(cs->''prerequisites'') = ''array'' then cs->''prerequisites'' end,
           ''next'', case when jsonb_typeof(cs->''next'') = ''array'' then cs->''next'' end,
           ''vocabulary'', case when jsonb_typeof(cs->''vocabulary'') = ''array'' then cs->''vocabulary'' end,
           ''misconception'', nullif(cs->>''misconception'', ''''),
           ''example'', nullif(cs->>''example'', ''''),
           ''dok'', public.safe_int(cs->>''dok''),
           ''source'', nullif(cs->>''source'', ''''),
           ''officialCode'', nullif(cs->>''officialCode'', ''''))), ''{}''::jsonb)'],
    array['sync_workspace',
      'from jsonb_array_elements(coalesce(p_data->''customStandards'',''[]''::jsonb)) cs where cs->>''code'' is not null',
      'from (select distinct on (coalesce(nullif(el.v->>''framework'',''''),''Custom''), el.v->>''grade'', el.v->>''subject'', el.v->>''code'') el.v
          from jsonb_array_elements(coalesce(p_data->''customStandards'',''[]''::jsonb)) with ordinality el(v, pos)
         where el.v->>''code'' is not null
         order by coalesce(nullif(el.v->>''framework'',''''),''Custom''), el.v->>''grade'', el.v->>''subject'', el.v->>''code'', el.pos desc) cs_src(cs)'],
    array['sync_workspace',
      'on conflict (teacher_id, code) where teacher_id is not null do update set',
      'on conflict (teacher_id, framework, grade, subject, code) where teacher_id is not null do update set'],
    array['sync_workspace',
      'domain = excluded.domain, cluster = excluded.cluster, updated_at = now();',
      'domain = excluded.domain, cluster = excluded.cluster, meta = excluded.meta, updated_at = now();'],
    array['sync_workspace',
      'delete from public.standards where teacher_id = p_teacher and not (code = any(ids));',
      'delete from public.standards s where s.teacher_id = p_teacher and not exists (
    select 1 from jsonb_array_elements(coalesce(p_data->''customStandards'',''[]''::jsonb)) cs
     where cs->>''code'' = s.code and coalesce(nullif(cs->>''framework'',''''),''Custom'') = s.framework
       and cs->>''grade'' = s.grade and cs->>''subject'' = s.subject);'],
    array['get_workspace_json',
      '''prerequisites'', ''[]''::jsonb,',
      '''prerequisites'', case when jsonb_typeof(m.meta -> ''prerequisites'') = ''array''
                          then m.meta -> ''prerequisites'' else ''[]''::jsonb end,'],
    array['get_workspace_json',
      '''next'', ''[]''::jsonb,',
      '''next'', case when jsonb_typeof(m.meta -> ''next'') = ''array''
                          then m.meta -> ''next'' else ''[]''::jsonb end,'],
    array['get_workspace_json',
      '''vocabulary'', ''[]''::jsonb,',
      '''vocabulary'', case when jsonb_typeof(m.meta -> ''vocabulary'') = ''array''
                          then m.meta -> ''vocabulary'' else ''[]''::jsonb end,'],
    array['get_workspace_json',
      '''source'', coalesce(m.meta ->> ''source'', '''')',
      '''source'', coalesce(m.meta ->> ''source'', '''')) || jsonb_strip_nulls(jsonb_build_object(''officialCode'', m.meta ->> ''officialCode'')']
  ];
  fn text;
  i int;
  hits int;
begin
  foreach fn in array array['sync_workspace', 'get_workspace_json'] loop
    def := pg_get_functiondef(case fn
      when 'sync_workspace' then 'public.sync_workspace(uuid,jsonb)'::regprocedure
      else 'public.get_workspace_json(uuid)'::regprocedure end);
    for i in 1 .. array_length(edits, 1) loop
      continue when edits[i][1] <> fn;
      if position(edits[i][3] in def) > 0 then
        continue; -- already applied
      end if;
      hits := (length(def) - length(replace(def, edits[i][2], ''))) / length(edits[i][2]);
      if hits <> 1 then
        raise exception 'custom_standards migration: % fragment found % times, expected 1: %', fn, hits, edits[i][2];
      end if;
      def := replace(def, edits[i][2], edits[i][3]);
    end loop;
    execute def;
  end loop;
end
$patch$;

-- Only now, with sync_workspace no longer naming it, can the old key go. See
-- the R9 EXCEPTION note at the top: a unique index cannot be made non-unique.
drop index if exists public.custom_standards_key;
