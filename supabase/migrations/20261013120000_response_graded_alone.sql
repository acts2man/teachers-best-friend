-- StudentResponse.gradedAlone: the teacher pulled this answer out of its group
-- in Grade by question ("Grade on their own"). #126 round 3, Ricky's question 8
-- (12 Oct 2026): the separation lived only in the browser, so a pulled-out
-- student merged back into his old group once given the same credit, "Change"
-- on that group regraded him, and the green "Confirm N" bar confirmed him while
-- his own credit form was open. NOT applied by the author -- apply by hand
-- before merging #126.
--
-- CLAUDE.md, "Workspace persistence": a field on a workspace type is dropped on
-- save unless BOTH sync_workspace and get_workspace_json name it. This adds the
-- column and teaches both functions about it.
--
-- How (same as 20261012200000): read the LIVE definition with
-- pg_get_functiondef, replace exactly these fragments, and stop with an error
-- naming the fragment if any is not found exactly once. Written against the
-- definitions on production after 20261012200000 (md5 259d331f... and
-- dbede685...), checked on a copy of them.
--
-- Only `true` is stored; anything else (absent, false, "abc") is NULL, which
-- get_workspace_json leaves out -- so no value a save sends can fail it.
--
-- Proof: supabase/checks/graded-alone-round-trip.sql, run by hand AFTER this
-- file; it rolls itself back.

set lock_timeout = '5s';

alter table public.student_responses
  add column if not exists graded_alone boolean;

do $patch$
declare
  def text;
  -- [function, fragment, replacement]
  edits text[][] := array[
    array['sync_workspace',
      'final_answer, answer_region, suggested_error_type)',
      'final_answer, answer_region, suggested_error_type, graded_alone)'],
    array['sync_workspace',
      'nullif(r->>''suggestedErrorType'','''')',
      'nullif(r->>''suggestedErrorType'',''''), case when public.safe_bool(r->>''gradedAlone'') then true end'],
    array['sync_workspace',
      'suggested_error_type = excluded.suggested_error_type;',
      'suggested_error_type = excluded.suggested_error_type, graded_alone = excluded.graded_alone;'],
    array['get_workspace_json',
      '''suggestedErrorType'', r.suggested_error_type))',
      '''suggestedErrorType'', r.suggested_error_type, ''gradedAlone'', r.graded_alone))']
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
        raise exception 'graded_alone migration: % fragment found % times, expected 1: %', fn, hits, edits[i][2];
      end if;
      def := replace(def, edits[i][2], edits[i][3]);
    end loop;
    execute def;
  end loop;
end
$patch$;
