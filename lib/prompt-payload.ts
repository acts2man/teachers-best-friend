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
