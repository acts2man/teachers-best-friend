import { activeQuestions } from "./teacher-workflow";
import type { Assessment, Standard } from "./teacher-types";

/**
 * What the model is actually shown.
 *
 * These shape the two largest pieces of every analysis prompt. They are kept
 * here, free of server imports, so they can be exercised directly in tests --
 * prompt size is a cost line, and a quiet regression in it is invisible until
 * the bill arrives.
 */

/**
 * The catalog as the alignment task needs to see it.
 *
 * buildPrompt used to ship the whole Standard object for every standard in the
 * grade and subject. Most of a Standard exists for the teacher's Standards
 * page, not for matching a question to a code: skills, prerequisites, next,
 * vocabulary, misconception, example, source and dok are never referenced by
 * the alignment instruction, and `summary` duplicates `wording`.
 *
 * That was wasteful before and got worse once get_workspace_json started
 * returning the AI-enriched fields with real content instead of empty arrays
 * and placeholder text. On a 35-standard catalog the full object is ~6,400
 * tokens of prompt, of which ~3,700 is never read.
 */
export function catalogForPrompt(catalog: Standard[]) {
  return catalog.map((s) => ({
    code: s.code,
    title: s.title,
    subject: s.subject,
    grade: s.grade,
    domain: s.domain,
    cluster: s.cluster,
    wording: s.wording || s.summary,
  }));
}

/**
 * The questions as the grading task needs to see them.
 *
 * "responses" is the volume call -- once per student per assessment -- and it
 * was shipping every Question field, including the two longest free-text ones
 * (`improvement` and `reasoning`) plus alignment, confidence, level, verified
 * and costas. Grading compares a student's work against the confirmed key and
 * the question's standard and skill; none of the rest is read.
 *
 * Excluded questions are dropped here too. The instruction already asks for
 * "every non-excluded question", and normalizeRecognizedResponses maps the
 * result over activeQuestions(), so sending them was pure cost.
 */
export function questionsForGrading(a: Assessment) {
  return activeQuestions(a).map((q) => ({
    id: q.id,
    number: q.number,
    text: q.text,
    passage: q.passage,
    answer: q.answer,
    standard: q.standard,
    skill: q.skill,
  }));
}

/** How much of a transcribed passage travels with a grading request. Long
 * enough for the short stories a pilot teacher described (3-10 pages), and a
 * ceiling so one enormous upload cannot quietly inflate every scan. */
export const PASSAGE_LIMIT = 40000;

/**
 * The shared reading passage, if this assessment has one, as a prompt fragment.
 *
 * A comprehension question cannot be marked honestly without the text it is
 * about: asked "why did he change his mind", a model with only the question and
 * the teacher's key is guessing. The story is read once when it is uploaded and
 * kept as text, so every student's grading can carry all of it -- text is a
 * fraction of the cost of the photographed pages, which is what makes sending
 * it to all 150 students affordable at all.
 *
 * Empty string when there is no passage, so a math assessment sends nothing and
 * costs exactly what it does today.
 */
export function passageForGrading(a: Assessment) {
  const passage = (a.passage || "").trim();
  if (!passage) return "";
  const text =
    passage.length > PASSAGE_LIMIT
      ? passage.slice(0, PASSAGE_LIMIT) + "\n[passage truncated]"
      : passage;
  return (
    " The questions below are about this shared reading passage. Judge each" +
    " answer against the passage as well as the teacher's key, and never" +
    " against your own recollection of the text. Passage: " +
    JSON.stringify(text) +
    "."
  );
}
