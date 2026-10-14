-- Question.secondChoice: the question's standard is the AI's SECOND choice,
-- filled in because its first choice was not in the teacher's standards list
-- (#129). Round-3 review: the mark was text at the start of the editable
-- reasoning box, so a teacher who deleted that text and pressed "Looks good --
-- confirm all" confirmed the guess. It is now its own field. NOT applied by the
-- author -- apply by hand before merging #129.
--
-- CLAUDE.md, "Workspace persistence": a field on a workspace type is dropped on
-- save unless BOTH sync_workspace and get_workspace_json name it. This adds the
-- column and teaches both functions about it.
--
-- How (same as 20261012200000): read the LIVE definition with
-- pg_get_functiondef, replace exactly these fragments, and stop with an error
-- naming the fragment if any is not found exactly once. Written against the
-- definitions on production after 20261012200000 (md5 259d331f... and
-- dbede685...), checked on a copy of them. It touches only the questions part
-- of the functions, so it applies before or after 20261013120000 (#126, the
-- responses part); both orders were run on the copy.
--
-- Only `true` is stored; anything else (absent, false, "abc") is NULL, which
-- get_workspace_json leaves out -- so no value a save sends can fail it.
--
-- Proof: supabase/checks/second-choice-round-trip.sql, run by hand AFTER this
-- file; it rolls itself back.

set lock_timeout = '5s';

alter table public.assessment_questions
  add column if not exists second_choice boolean;

do $patch$
declare
  def text;
  -- [function, fragment, replacement]
  edits text[][] := array[
    array['sync_workspace',
      'reasoning, verified, excluded, key_check, points, answer_parts)',
      'reasoning, verified, excluded, key_check, points, answer_parts, second_choice)'],
    array['sync_workspace',
      'nullif(least(greatest(coalesce(public.safe_int(q->>''answerParts''), 1), 1), 20), 1)',
      'nullif(least(greatest(coalesce(public.safe_int(q->>''answerParts''), 1), 1), 20), 1), case when public.safe_bool(q->>''secondChoice'') then true end'],
    array['sync_workspace',
      'answer_parts = excluded.answer_parts,',
      'answer_parts = excluded.answer_parts, second_choice = excluded.second_choice,'],
    array['get_workspace_json',
      '''answerParts'', q.answer_parts))',
      '''answerParts'', q.answer_parts, ''secondChoice'', q.second_choice))']
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
        raise exception 'second_choice migration: % fragment found % times, expected 1: %', fn, hits, edits[i][2];
      end if;
      def := replace(def, edits[i][2], edits[i][3]);
    end loop;
    execute def;
  end loop;
end
$patch$;
