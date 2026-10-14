-- Custom standards: one per code per save (gap G8), and their extras survive a
-- reload (gap G11). docs/system-map.md, rules R14 and R2. NOT applied by the
-- author -- apply by hand before merging the PR that adds it.
--
-- G8. Custom standards are unique on (teacher_id, code) (custom_standards_key,
-- 20260909214251). The app keys them by framework, grade and code, so a
-- workspace could hold the same code twice (a second framework that uses the
-- same codes, the same code added by hand under another framework, or one AI
-- catalog answer listing a code twice). sync_workspace's upsert then touched
-- one row twice and Postgres refused the whole save ("ON CONFLICT DO UPDATE
-- command cannot affect row a second time"): the change that added the second
-- copy was lost with an error. The app no longer creates a second copy; this
-- makes the save keep the first copy of each code in the saved list
-- (`distinct on`, ordered by position) instead of failing, whatever sends it.
-- A per-framework key would keep both copies; it needs custom_standards_key
-- dropped, which rule R9 does not allow in a migration, so it is proposed
-- separately rather than done here.
--
-- G11. sync_workspace never wrote a custom standard's skills, prerequisites,
-- next, vocabulary, misconception, example, dok or source, and
-- get_workspace_json hard-coded prerequisites, next and vocabulary to []. The
-- teacher's own "skills" from Standards > Add were gone after a refresh. They
-- now go into standards.meta (the column the shared catalog already uses for
-- the same extras, 20260914202357), and get_workspace_json reads them back.
--
-- What is stored is only what the teacher's copy ADDS: a value equal to the
-- shared catalog's for the same code, framework and grade, or equal to the
-- default get_workspace_json fills in (dok 2, the two default sentences), or
-- empty, is left out. The read merges key by key -- catalog first, the
-- teacher's own values on top -- so a catalog refresh still reaches every
-- value the teacher did not change, and a custom standard with no values of
-- its own reads exactly as before. (Review of the G8+G11 PR: storing the full
-- snapshot the client sends froze the catalog values on the first save.)
--
-- Also: the list of codes to keep ignored a NULL code only in the insert, so
-- one entry without a code made `code = any(ids)` NULL and no custom standard
-- was ever deleted. The ids select now skips it too.
--
-- How (same as 20261013130000): read the LIVE definition with
-- pg_get_functiondef, replace exactly these fragments, and stop with an error
-- naming the fragment if any is not found exactly once. Written against the
-- definitions on production on 14 Oct 2026 (sync_workspace md5 107ada86...,
-- get_workspace_json md5 eb1bfac3...), checked on a copy of them. It touches
-- only the custom-standards parts, so it applies before or after
-- 20261014150000 (G4), which does not change either function.
--
-- No new column, no DDL beyond the two function bodies. Nothing to drop.
--
-- Proof: supabase/checks/custom-standards-round-trip.sql, run by hand AFTER
-- this file; it rolls itself back.

set lock_timeout = '5s';

do $patch$
declare
  def text;
  -- [function, fragment, replacement]
  edits text[][] := array[
    array['sync_workspace',
      'insert into public.standards (teacher_id, jurisdiction, framework, subject, grade, code, short_label, description, domain, cluster)',
      'insert into public.standards (teacher_id, jurisdiction, framework, subject, grade, code, short_label, description, domain, cluster, meta)'],
    array['sync_workspace',
      'select p_teacher, ''CA'', coalesce',
      'select distinct on (cs->>''code'') p_teacher, ''CA'', coalesce'],
    array['sync_workspace',
      'nullif(cs->>''domain'',''''), nullif(cs->>''cluster'','''')',
      'nullif(cs->>''domain'',''''), nullif(cs->>''cluster'',''''),
         nullif((
           select coalesce(jsonb_object_agg(kv.key, kv.value), ''{}''::jsonb)
             from jsonb_each(jsonb_strip_nulls(jsonb_build_object(
               ''skills'', case when jsonb_typeof(cs->''skills'') = ''array'' and jsonb_array_length(cs->''skills'') > 0 then cs->''skills'' end,
               ''prerequisites'', case when jsonb_typeof(cs->''prerequisites'') = ''array'' and jsonb_array_length(cs->''prerequisites'') > 0 then cs->''prerequisites'' end,
               ''next'', case when jsonb_typeof(cs->''next'') = ''array'' and jsonb_array_length(cs->''next'') > 0 then cs->''next'' end,
               ''vocabulary'', case when jsonb_typeof(cs->''vocabulary'') = ''array'' and jsonb_array_length(cs->''vocabulary'') > 0 then cs->''vocabulary'' end,
               ''misconception'', nullif(nullif(cs->>''misconception'',''''), ''Use the student''''s written reasoning to identify the step that needs support.''),
               ''example'', nullif(nullif(cs->>''example'',''''), ''Choose a task that directly demonstrates this standard.''),
               ''dok'', case when public.safe_int(cs->>''dok'') between 1 and 4 and public.safe_int(cs->>''dok'') <> 2 then public.safe_int(cs->>''dok'') end,
               ''source'', nullif(cs->>''source'','''')
             ))) kv
            where kv.value is distinct from (
              select g.meta -> kv.key from public.standards g
               where g.teacher_id is null and g.active and g.code = cs->>''code''
                 and g.framework = coalesce(nullif(cs->>''framework'',''''),''Custom'') and g.grade = cs->>''grade''
               limit 1)
         ), ''{}''::jsonb)'],
    array['sync_workspace',
      'from jsonb_array_elements(coalesce(p_data->''customStandards'',''[]''::jsonb)) cs where cs->>''code'' is not null',
      'from jsonb_array_elements(coalesce(p_data->''customStandards'',''[]''::jsonb)) with ordinality as e(cs, n) where cs->>''code'' is not null
  order by cs->>''code'', n'],
    array['sync_workspace',
      'domain = excluded.domain, cluster = excluded.cluster, updated_at = now();',
      'domain = excluded.domain, cluster = excluded.cluster, meta = excluded.meta, updated_at = now();'],
    array['sync_workspace',
      'select coalesce(array_agg(cs->>''code''), ''{}'') into ids from jsonb_array_elements(coalesce(p_data->''customStandards'',''[]''::jsonb)) cs;',
      'select coalesce(array_agg(cs->>''code''), ''{}'') into ids from jsonb_array_elements(coalesce(p_data->''customStandards'',''[]''::jsonb)) cs where cs->>''code'' is not null;'],
    array['get_workspace_json',
      'select coalesce(
        s.meta,
        (select g.meta from public.standards g
          where g.teacher_id is null and g.active
            and g.code = s.code and g.framework = s.framework and g.grade = s.grade
          limit 1)
      ) as meta',
      'select coalesce(
        (select g.meta from public.standards g
          where g.teacher_id is null and g.active
            and g.code = s.code and g.framework = s.framework and g.grade = s.grade
          limit 1), ''{}''::jsonb) || coalesce(s.meta, ''{}''::jsonb) as meta'],
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
                          then m.meta -> ''vocabulary'' else ''[]''::jsonb end,']
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
        raise exception 'custom standards migration: % fragment found % times, expected 1: %', fn, hits, edits[i][2];
      end if;
      def := replace(def, edits[i][2], edits[i][3]);
    end loop;
    execute def;
  end loop;
end
$patch$;
