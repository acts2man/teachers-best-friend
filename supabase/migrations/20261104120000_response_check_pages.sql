-- StudentResponse.checkPages: grading may have put another paper's answers on
-- this student (Michael, 2 Nov 2026: a class-set request returned page 6's
-- answers for the student of page 5 and the other way round). Set when the
-- name the grading pass read on the pile's pages fits neither the confirmed
-- student nor the name read off the pile (lib/answer-mixups.ts); Grade by
-- question shows "Answers may belong to another page — check" until the
-- teacher moves the answers or says they are right. NOT applied by the
-- author -- apply by hand before merging.
--
-- CLAUDE.md, "Workspace persistence": a field on a workspace type is dropped on
-- save unless BOTH sync_workspace and get_workspace_json name it. Without this
-- the mark shows after a scan and is gone on the next reload.
--
-- How (same as 20261013120000_response_graded_alone): read the LIVE
-- definitions with pg_get_functiondef, replace exactly these fragments, and
-- stop with an error naming the fragment if any is not found exactly once.
-- Each fragment was counted on production on 4 Nov 2026 with a read-only
-- SELECT: every one found exactly once (sync_workspace md5 047e3654...,
-- get_workspace_json md5 fd26ecbf...).
--
-- Only `true` is stored; anything else (absent, false, "abc") is NULL, which
-- get_workspace_json leaves out -- so no value a save sends can fail it, and
-- a save without the mark (the teacher decided) clears it.
--
-- Proof: supabase/checks/check-pages-round-trip.sql, run by hand AFTER this
-- file; it rolls itself back.

set lock_timeout = '5s';

alter table public.student_responses
  add column if not exists check_pages boolean;

do $patch$
declare
  def text;
  -- [function, fragment, replacement]
  edits text[][] := array[
    array['sync_workspace',
      'suggested_error_type, graded_alone)',
      'suggested_error_type, graded_alone, check_pages)'],
    array['sync_workspace',
      'case when public.safe_bool(r->>''gradedAlone'') then true end',
      'case when public.safe_bool(r->>''gradedAlone'') then true end, case when public.safe_bool(r->>''checkPages'') then true end'],
    array['sync_workspace',
      'graded_alone = excluded.graded_alone;',
      'graded_alone = excluded.graded_alone, check_pages = excluded.check_pages;'],
    array['get_workspace_json',
      '''gradedAlone'', r.graded_alone))',
      '''gradedAlone'', r.graded_alone, ''checkPages'', r.check_pages))']
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
        raise exception 'check_pages migration: % fragment found % times, expected 1: %', fn, hits, edits[i][2];
      end if;
      def := replace(def, edits[i][2], edits[i][3]);
    end loop;
    execute def;
  end loop;
end
$patch$;
