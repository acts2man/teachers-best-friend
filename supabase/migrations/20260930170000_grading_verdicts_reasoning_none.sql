-- Grading no longer reasons: verdict-only output runs at effort 'none'.
--
-- Why: the 'responses' and 'class_scan' stages used to ask the model for a
-- partial-credit percentage and a written misconception per answer, which is
-- what the low-effort reasoning was paying for. Grading now asks for one verdict
-- per answer -- match, blank, or other -- and nothing else: partial credit is
-- the teacher's to decide in Grade by question, not the model's to guess. A
-- verdict needs no reasoning, so both stages move to 'none', which drops the
-- reasoning tokens that were the larger half of the 'responses' bill.
--
-- Measured baseline (production scans, before this change):
--   responses:  avg $0.00446/scan  (in 5,550 tok, visible out 1,064 tok)
--   class_scan: avg $0.00784/scan  (in 24,298 tok, out 2,487 tok)
-- Input is dominated by the page images and is unchanged; the saving is the
-- reasoning and the now-unwritten misconception/percentage output. The real
-- after-cost is confirmed against live usage once this ships, not asserted here.
--
-- The model, the max_output_tokens ceiling and everything else are unchanged --
-- max_output_tokens is a limit, not a purchase, so leaving the headroom costs
-- nothing. 'none' is already permitted by the reasoning_effort CHECK constraint
-- (see 20260927170000_retire_minimal_reasoning_effort.sql).
update public.pipeline_config
   set reasoning_effort = 'none',
       updated_at = now(),
       notes = 'Grades one verdict per answer (match/blank/other); no partial credit and no misconception, so no reasoning. Partial credit is decided by the teacher in Grade by question.'
 where stage = 'responses';

update public.pipeline_config
   set reasoning_effort = 'none',
       updated_at = now(),
       notes = 'Batch scan of pages already grouped by student. Grades one verdict per answer (match/blank/other); no partial credit and no misconception, so no reasoning.'
 where stage = 'class_scan';
