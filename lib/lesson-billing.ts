/**
 * What a lesson costs (review of #199). One Generate writes the lesson in
 * Visual, Hands-on and Auditory as three requests side by side; it costs ONE
 * credit, not three, and "Add question" costs none.
 *
 *  - The `full` request (the lesson in the chosen approach, with the practice,
 *    exit ticket, game and performance task) is the one credit, charged as
 *    every generation is (create_scan, gen:<scanId>).
 *  - The `flow` requests (the other two approaches) and `question` ("Add
 *    question") are not billable: no credit. They still pass the spend gate
 *    like every model call, so the money ceilings hold.
 *  - If any of the three fails, the credit comes back: the app asks
 *    /api/lessons/refund, and refund_lesson_generation checks on the server
 *    that a request of the same run (lessonRun) really failed before it
 *    releases the charge. The client cannot refund a lesson that worked.
 */
import type { AnalyzeParams } from "./analyze-shared";

export function lessonPartIsFree(p: Pick<AnalyzeParams, "mode" | "lessonPart">): boolean {
  return p.mode === "lesson" && (p.lessonPart === "flow" || p.lessonPart === "question");
}

/**
 * The full lesson's output ceiling. Since #199 it carries a Game-Based
 * Learning and a Performance Task section and an answer for every practice
 * and exit question, on top of what the 6,000-token stage limit was set for
 * (the 16 lessons on record used 940-1,516). pipeline_config is not changed:
 * this is a floor for the full request only, so a lower configured value can
 * never cut a whole lesson off.
 */
export const LESSON_FULL_MIN_OUTPUT = 12000;

export function lessonOutputCeiling(p: Pick<AnalyzeParams, "mode" | "lessonPart">, configured: number): number {
  if (p.mode !== "lesson" || (p.lessonPart ?? "full") !== "full") return configured;
  return Math.max(configured, LESSON_FULL_MIN_OUTPUT);
}

/** What the teacher reads when the model ran out of room. */
export function incompleteMessage(mode: AnalyzeParams["mode"]): string {
  return mode === "lesson"
    ? "This lesson came out longer than the AI can write in one go, so it was cut off. Nothing was charged — generate again, or shorten your notes."
    : "This document needs a smaller batch. Try fewer pages.";
}

/** A Generate refused for credit: nothing ran and nothing was charged. */
export const OUT_OF_CREDITS_FOR_LESSON =
  "Generating a lesson uses 1 credit, and you have none left this period, so it wasn’t written. Nothing was charged. You can add more on Plan and billing.";

