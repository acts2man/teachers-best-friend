-- The analysis pipeline was storing alignment/confidence as 0-1 fractions
-- while the app renders them as percentages ("0.98%" instead of "98%") and
-- color-codes them on a 0-100 scale, so every question read as poorly
-- aligned. The pipeline now emits whole-number percentages; bring the rows
-- written before that fix onto the same scale.
--
-- Guarded by `<= 1` so this is idempotent and cannot double-scale a row that
-- is already a percentage. A stored 0 stays 0 either way.
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

