/**
 * How a replay is scored against what the teacher confirmed. Pure, and unit
 * tested, so the numbers the replay page shows are the numbers these rules give.
 *
 * Names: each pile assigned to the teacher-confirmed student. A pile the app
 *   pre-fills with the WRONG student is the failure that matters most -- it
 *   rides through unless spotted -- so it is counted on its own and any one of
 *   them fails the case.
 * Answer reading: the final answer read matches what the teacher confirmed.
 * Grouping: each student's answer lands in the group the teacher confirmed --
 *   the same final answer, not sent to Unsure. Misses are split into the
 *   categories the founders asked about. Marked correct when the teacher gave
 *   less than full credit, and marked blank where the teacher saw an answer,
 *   are each counted and each fail the case outright.
 * Answer key / standards: per question, against the confirmed key and tags.
 */
import { answerKey } from "@/lib/teacher-workflow";
import { compareAnswers } from "@/lib/math-answer";
import type { StudentResponse } from "@/lib/teacher-types";
import type { ExpectedAnswer, ExpectedPile } from "./types";

/** Pass marks. Names: 24 of 26 is the founders' bar (92%). Answers: 95%. */
export const PASS = { names: 0.92, answers: 0.95, key: 0.95, standards: 0.95 } as const;

const ratio = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 1000 : 1);

export type NamesScore = {
  piles: number;
  correct: number;
  /** Pre-filled with a student who is not the one the teacher confirmed. */
  wrongConfident: number;
  /** Left for the teacher to choose (no pre-fill). */
  unassigned: number;
  /** Of those left open, how many had the right student as the suggestion. */
  rightSuggestion: number;
  /** Piles with no name-area copy to read (not counted in the accuracy). */
  noStrip: number;
  accuracy: number;
  passed: boolean;
};

export function scoreNames(
  piles: ExpectedPile[],
  resolved: { studentId: string | null; suggestedId: string | null }[],
): NamesScore {
  let correct = 0;
  let wrongConfident = 0;
  let unassigned = 0;
  let rightSuggestion = 0;
  let noStrip = 0;
  piles.forEach((pile, i) => {
    const r = resolved[i];
    // No name-area copy was kept for this pile, so nothing was asked of the
    // model: counted apart, not blamed on the read.
    if (pile.strips && !pile.strips.some(Boolean)) {
      noStrip++;
      if (r?.studentId && r.studentId !== pile.studentId) wrongConfident++;
      return;
    }
    if (!r || !r.studentId) {
      unassigned++;
      if (r?.suggestedId === pile.studentId) rightSuggestion++;
    } else if (r.studentId === pile.studentId) correct++;
    else wrongConfident++;
  });
  const accuracy = ratio(correct, piles.length - noStrip);
  return {
    piles: piles.length,
    correct,
    wrongConfident,
    unassigned,
    rightSuggestion,
    noStrip,
    accuracy,
    passed: wrongConfident === 0 && accuracy >= PASS.names,
  };
}

/** The parts of a multi-part final answer: "y=4; (0,10/3)" is two. */
export function answerParts(final: string): number {
  const parts = final.split(/;|\n/).map((p) => p.trim()).filter(Boolean);
  return parts.length;
}

export type AnswerMiss =
  | "unsure"
  | "wrong_final"
  | "equivalent_not_grouped"
  | "teacher_split_same_answer"
  | "wrongly_blank"
  | "not_returned";

export type AnswersScore = {
  answers: number;
  /** Final answer read the same as the read the teacher accepted. NOT proof
   * the read was right: the app keeps no field for "the student actually
   * wrote X", so the accepted read is the earlier model's text wherever the
   * teacher did not change it. The credit is the independent ground truth. */
  readRight: number;
  readAccuracy: number;
  /** In exactly the group the teacher ended up with: the same students share
   * this answer's group in the replay as shared the teacher's (final answer,
   * credit) group. A group the teacher had to split, or merge, is a miss. */
  inGroup: number;
  groupAccuracy: number;
  /** Marked correct where the teacher gave less than full credit. */
  wronglyCorrect: number;
  /** Marked blank where the teacher saw an answer. */
  wronglyBlank: number;
  /** Teacher gave full credit, the replay did not pre-mark it correct. */
  missedCorrect: number;
  unsure: number;
  misses: Record<AnswerMiss, number>;
  /** Multi-part questions: parts the read RETURNED (not parts read right),
   * against parts in the confirmed answer, summed. */
  partsReturned: number;
  partsExpected: number;
  passed: boolean;
};

/**
 * Scores replayed answers against confirmed ones. `replayed` are the responses
 * the app would save (normalizeRecognizedResponses output), for all students.
 * `kind` picks which accuracy decides the pass.
 */
export function scoreAnswers(
  expected: ExpectedAnswer[],
  replayed: StudentResponse[],
  kind: "answer_reading" | "grouping",
  expectedParts: Record<string, number> = {},
): AnswersScore {
  const misses: Record<AnswerMiss, number> = {
    unsure: 0,
    wrong_final: 0,
    equivalent_not_grouped: 0,
    teacher_split_same_answer: 0,
    wrongly_blank: 0,
    not_returned: 0,
  };
  let readRight = 0;
  let inGroup = 0;
  let unsure = 0;
  let wronglyCorrect = 0;
  let missedCorrect = 0;
  let partsReturned = 0;
  let partsExpected = 0;

  const want = (e: ExpectedAnswer) => e.finalAnswer || e.answer;
  const find = (e: ExpectedAnswer) => replayed.find((x) => x.studentId === e.studentId && x.questionId === e.questionId);
  const isUnsure = (r: StudentResponse) => !r.verified && r.confidence < 50;
  const got = (r: StudentResponse) => r.finalAnswer?.trim() || r.answer;
  // The teacher's groups: same final answer AND same credit, per question.
  const teacherKey = (e: ExpectedAnswer) => answerKey(want(e)) + "|" + (e.match ?? "-");
  // The replay's groups, as Grade by question would draw them before anyone decides.
  const replayKey = (r: StudentResponse | undefined) => (!r ? "\u0000none" : isUnsure(r) ? "\u0000unsure" : answerKey(got(r)));
  const members = (q: string, keyOf: (e: ExpectedAnswer) => string, key: string) =>
    expected.filter((x) => x.questionId === q && keyOf(x) === key).map((x) => x.studentId).sort().join(",");

  for (const e of expected) {
    const r = find(e);
    const w = want(e);
    const wantedBlank = !w.trim();
    const partsWanted = expectedParts[e.questionId] ?? answerParts(w);
    if (partsWanted > 1) partsExpected += partsWanted;
    if (!r) {
      misses.not_returned++;
      continue;
    }
    const unsureHere = isUnsure(r);
    const isBlank = !unsureHere && r.match === 0 && !r.answer.trim();
    const isMatch = r.correct && (r.match ?? 0) >= 100;
    const g = got(r);
    if (partsWanted > 1) partsReturned += Math.min(answerParts(g), partsWanted);
    if (isMatch && (e.match ?? 0) < 100) wronglyCorrect++;
    if (!isMatch && (e.match ?? 0) >= 100) missedCorrect++;
    if (unsureHere) unsure++;
    const sameFinal = answerKey(g) === answerKey(w);
    const equivalent = !sameFinal && !!g.trim() && !wantedBlank && compareAnswers(g, w) === "same";
    if (!unsureHere && (sameFinal || equivalent)) readRight++;

    const sameMembers =
      members(e.questionId, teacherKey, teacherKey(e)) ===
      members(e.questionId, (x) => replayKey(find(x)), replayKey(r));
    // Same members AND the same (or an equivalent) answer: a student alone in
    // a group otherwise "matches" the teacher's group of one whatever was read.
    if (!unsureHere && sameMembers && (sameFinal || equivalent)) {
      inGroup++;
      continue;
    }
    if (unsureHere) misses.unsure++;
    else if (isBlank && !wantedBlank) misses.wrongly_blank++;
    else if (equivalent) misses.equivalent_not_grouped++;
    else if (sameFinal) misses.teacher_split_same_answer++;
    else misses.wrong_final++;
  }
  const n = expected.length;
  const readAccuracy = ratio(readRight, n);
  const groupAccuracy = ratio(inGroup, n);
  const decisive = kind === "grouping" ? groupAccuracy : readAccuracy;
  return {
    answers: n,
    readRight,
    readAccuracy,
    inGroup,
    groupAccuracy,
    wronglyCorrect,
    wronglyBlank: misses.wrongly_blank,
    missedCorrect,
    unsure,
    misses,
    partsReturned,
    partsExpected,
    passed: decisive >= PASS.answers && wronglyCorrect === 0 && misses.wrongly_blank === 0,
  };
}

export type ListScore = { items: number; right: number; accuracy: number; missing: number; passed: boolean };

/** Answer key: the read key matches the confirmed one by value
 * (compareAnswers), question by question number. */
export function scoreKey(
  expected: { number: number; answer: string }[],
  read: { number: number; answer: string }[],
): ListScore {
  let right = 0;
  let missing = 0;
  for (const e of expected) {
    const r = read.find((q) => q.number === e.number);
    if (!r) missing++;
    else if (compareAnswers(r.answer, e.answer) === "same") right++;
  }
  const accuracy = ratio(right, expected.length);
  return { items: expected.length, right, accuracy, missing, passed: accuracy >= PASS.key };
}

/** Standards: the read standard equals the teacher's tag, by question number. */
export function scoreStandards(
  expected: { number: number; standard: string }[],
  read: { number: number; standard: string }[],
): ListScore {
  let right = 0;
  let missing = 0;
  for (const e of expected) {
    const r = read.find((q) => q.number === e.number);
    if (!r) missing++;
    else if (r.standard.trim().toLowerCase() === e.standard.trim().toLowerCase()) right++;
  }
  const accuracy = ratio(right, expected.length);
  return { items: expected.length, right, accuracy, missing, passed: accuracy >= PASS.standards };
}
