-- Give a whole-class scan room for the batch the app now plans.
--
-- Measured across this app's real scans: grading one student averages 1,173
-- output tokens and peaks at 4,933 on a ten-question test. The ceiling was
-- 12,000, and the UI allowed 24 pages -- twelve students front and back -- so
-- one class set asked for roughly 14,000 at the average and far more at the
-- peak. The provider returned `incomplete`, the scan failed, and the teacher
-- was told only to "try fewer pages".
--
-- The app now splits a class into batches sized against a 16,000 planning
-- budget (planScanBatches in lib/teacher-class-scan.ts). The ceiling has to sit
-- above that budget or the plan is fiction, so it goes to 24,000 -- the same
-- room the passage stage already uses -- leaving 8,000 of headroom for a batch
-- where the model writes a long misconception on every answer.
--
-- This costs nothing by itself: max_output_tokens is a limit, not a purchase.
update public.pipeline_config
   set max_output_tokens = 24000,
       notes = 'Batch scan: grades a stack of pages already grouped by student. The app splits a class into batches that fit this ceiling rather than sending one request per class, which used to come back incomplete on a real class set.'
 where stage = 'class_scan';
