-- Second rescale of the same columns, for the same reason as
-- 20260915005023, because the fix that stopped it was never deployed.
--
-- The pipeline asks for 0-100 and repairs a fraction if one arrives. That
-- repair shipped in e66956c on 15 Sep and works. Production has been serving
-- a build from before it, so every scan since has written 0-1 fractions
-- again: a well-aligned question stored as 0.95 renders as "0.95%", which is
-- what the pilot teacher reported as "1% or so".
--
-- This brings those rows onto the right scale. It does NOT stop new ones
-- being written wrong -- only deploying the current main does that. Run it
-- again after the deploy if any scans land in between.
--
-- Guarded by `<= 1` exactly as before, so it is idempotent and cannot
-- double-scale a row that is already a percentage. Accepted limitation,
-- unchanged from the first migration: a question genuinely aligned at 1% or
-- less is indistinguishable from a fraction and would be scaled to 100. The
-- pipeline emits a flat 0 when there is no match, so that case does not
-- arise in practice.

update public.assessment_questions
   set alignment = round(alignment * 100)
 where alignment is not null and alignment <= 1 and alignment > 0;

update public.assessment_questions
   set confidence = round(confidence * 100)
 where confidence is not null and confidence <= 1 and confidence > 0;

update public.student_responses
   set match_score = round(match_score * 100)
 where match_score is not null and match_score <= 1 and match_score > 0;

update public.student_responses
   set confidence = round(confidence * 100)
 where confidence is not null and confidence <= 1 and confidence > 0;
