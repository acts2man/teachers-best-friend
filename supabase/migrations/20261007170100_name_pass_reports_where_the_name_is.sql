-- The name pass now also reports where on the page the name is written (a box,
-- four numbers per page), so the matching screen can show the teacher a crop
-- of the handwriting. That roughly doubles what each page asks the model to
-- write, and the stage's 1,500-token ceiling also has to hold the reasoning.
-- The app now sends 12 name areas per request instead of 24 so that it fits
-- even before this is applied; this gives the ceiling room on top. A ceiling is
-- a limit, not a purchase: it costs nothing unless it is used.
--
-- The model is unchanged (gpt-5.4-nano at 'low').
update public.pipeline_config
   set max_output_tokens = 4000,
       updated_at = now(),
       notes = 'Reads the handwritten student name from the top part of each class-scan page (top 45%, reduced), anywhere near the Name line or in the margins, and where it sits. Shown no questions, no answer key and no roster; matching to a student happens in the app. Runs once per class scan; not billed to quota.'
 where stage = 'name_strip';
