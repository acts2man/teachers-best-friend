import type { Assessment, Question } from "./teacher-types";
import { compareAnswers } from "./math-answer";
import { activeQuestions } from "./teacher-workflow";

/**
 * The answer-key check: a key the app worked out itself is solved a second
 * time, independently, and every question where the two disagree goes to the
 * teacher before the key can be confirmed.
 *
 * Why (Ricky, 7 Oct): six reads of the same Algebra 2 worksheet each got 2 to
 * 5 of 15 answers wrong, in different places each time -- and a wrong key
 * grades the whole class wrong without anyone noticing. On those six reads,
 * using one read to check another flagged 83 of the 105 wrong answers.
 */

/** Whether this assessment's key came from the app rather than the teacher. */
export function keyIsGenerated(a: Assessment): boolean {
  return !a.answerKeyUploadIds?.length && a.source === "ai";
}

/** Questions with an answer the app worked out and nobody has checked yet. */
export function questionsToCheck(a: Assessment): Question[] {
  if (!keyIsGenerated(a) || a.answerKeyVerified) return [];
  return activeQuestions(a).filter((q) => q.answer.trim() && !q.keyCheck);
}

/**
 * Records the checker's answers. A question it could not answer ("") is left
 * unchecked rather than marked as agreeing; a disagreement is a "differs" the
 * teacher must settle. The comparison never ignores a sign (lib/math-answer).
 */
export function applyKeyCheck(
  a: Assessment,
  checked: { questionId: string; answer: string }[],
): Assessment {
  const byId = new Map(checked.map((c) => [c.questionId, c.answer.trim()]));
  return {
    ...a,
    questions: a.questions.map((q) => {
      const answer = byId.get(q.id);
      if (answer === undefined || !answer || !q.answer.trim() || q.keyCheck) return q;
      return {
        ...q,
        keyCheck: {
          answer,
          status: compareAnswers(q.answer, answer) === "same" ? "agrees" : "differs",
        },
      };
    }),
  };
}

/** Disagreements the teacher has not settled yet. */
export function openDisagreements(a: Assessment): Question[] {
  return activeQuestions(a).filter((q) => q.keyCheck?.status === "differs");
}

/** The teacher settled every open disagreement (by keeping, replacing or
 * editing the answer) and confirmed the key. */
export function settleDisagreements(a: Assessment): Assessment {
  return {
    ...a,
    questions: a.questions.map((q) =>
      q.keyCheck?.status === "differs"
        ? { ...q, keyCheck: { ...q.keyCheck, status: "resolved" } }
        : q,
    ),
  };
}
