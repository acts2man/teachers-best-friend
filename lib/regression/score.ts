/**
 * How a replay is scored against what the teacher confirmed. Pure, and unit
 * tested, so the numbers the replay page shows are the numbers these rules give.
 *
 * Names: each pile assigned to the teacher-confirmed student. A pile the app
 *   pre-fills with the WRONG student is the failure that matters most -- it
 *   rides through unless spotted -- so it is counted on its own and any one of
 *   them fails the case.
 * Answer reading: the final answer read matches what the teacher confirmed --
 *   by value, not by spelling (judgeAnswer, ./compare-answers): labels,
 *   spacing, Unicode minus, thousands separators and computation chains are
 *   normalised away. A read that kept only some parts of a multi-part answer
 *   is faithful but listed as missing parts; prose that cannot be compared is
 *   listed for a person to check, and is not counted as a miss.
 * Grouping: each student's answer lands in the group the teacher confirmed --
 *   the same final answer, not sent to Unsure. Misses are split into the
 *   categories the founders asked about. Marked correct when the teacher gave
 *   less than full credit, and marked blank where the teacher saw an answer,
 *   are each counted and each fail the case outright.
 * Answer key / standards: per question, against the confirmed key and tags.
 *   The key is judged the same way as reading (judgeAnswer); a wrong number
 *   (no rounding tolerance) or a different unit is a miss.
 */
import { answerKey } from "@/lib/teacher-workflow";
import { judgeAnswer, type ReadVerdict } from "./compare-answers";
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
  | "wrongly_blank"
  | "not_returned"
  /** Not a miss: prose that cannot be compared, for a person to check. Kept
   * here so every answer outside the right group is accounted for. */
  | "needs_human_check";

/** One answer shown side by side on the replay page: what the replay read,
 * and what was expected. */
export type SideBySide = { studentId: string; questionId: string; read: string; expected: string };

export type AnswersScore = {
  answers: number;
  /** Final answer read the same as the read the teacher accepted. NOT proof
   * the read was right: the app keeps no field for "the student actually
   * wrote X", so the accepted read is the earlier model's text wherever the
   * teacher did not change it. The credit is the independent ground truth. */
  readRight: number;
  readAccuracy: number;
  /** Grouped right: this answer's replay group and the teacher's group for
   * its final answer are each the other's majority (Unsure and unreturned
   * answers left out of the counting -- they are misses of their own). */
  inGroup: number;
  /** Answers the teacher gave different credit from classmates with the same
   * final answer (the work differed). Information only: no grouping by answer
   * can see work, so it is not a grouping miss (#124 review). */
  creditSplits: number;
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
  /** Read faithfully but with fewer parts than the confirmed answer: counted
   * in readRight, listed here. */
  partsMissing: SideBySide[];
  /** Prose that cannot be compared: not counted as a miss, listed here for a
   * person to judge. */
  needsHumanCheck: SideBySide[];
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
    wrongly_blank: 0,
    not_returned: 0,
    needs_human_check: 0,
  };
  const partsMissing: SideBySide[] = [];
  const needsHumanCheck: SideBySide[] = [];
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
  // Grouping is judged on the final answer alone: credit the teacher split by
  // work is counted separately (creditSplits), not as the model's miss.
  const groupKey = (e: ExpectedAnswer) => answerKey(want(e));
  // The replay's groups, as Grade by question would draw them before anyone decides.
  const replayKey = (r: StudentResponse | undefined) => (!r ? "\u0000none" : isUnsure(r) ? "\u0000unsure" : answerKey(got(r)));
  // Per question: which teacher group is the majority of each replay group,
  // and which replay group holds the majority of each teacher group. A tie
  // has no majority.
  const majorityCache = new Map<string, { replayToTeacher: Map<string, string>; teacherToReplay: Map<string, string> }>();
  const groupMajorities = (q: string) => {
    const hit = majorityCache.get(q);
    if (hit) return hit;
    const pairs = expected
      .filter((x) => x.questionId === q)
      .map((x) => [replayKey(find(x)), groupKey(x)] as const)
      .filter(([rk]) => rk !== "\u0000none" && rk !== "\u0000unsure");
    const majority = (from: 0 | 1) => {
      const counts = new Map<string, Map<string, number>>();
      for (const p of pairs) {
        const inner = counts.get(p[from]) ?? new Map<string, number>();
        inner.set(p[1 - from], (inner.get(p[1 - from]) ?? 0) + 1);
        counts.set(p[from], inner);
      }
      const out = new Map<string, string>();
      for (const [k, inner] of counts) {
        const ranked = [...inner.entries()].sort((x, y) => y[1] - x[1]);
        if (ranked.length === 1 || ranked[0][1] > ranked[1][1]) out.set(k, ranked[0][0]);
      }
      return out;
    };
    const m = { replayToTeacher: majority(0), teacherToReplay: majority(1) };
    majorityCache.set(q, m);
    return m;
  };

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
    const verdict: ReadVerdict = sameFinal ? "same" : !g.trim() || wantedBlank ? "different" : judgeAnswer(g, w);
    // Faithful: the same value, or the parts it kept are right.
    const equivalent = !sameFinal && (verdict === "same" || verdict === "parts_missing");
    const side = { studentId: e.studentId, questionId: e.questionId, read: g, expected: w };
    const humanCheck = !unsureHere && verdict === "needs_human_check";
    if (!unsureHere && (sameFinal || equivalent)) readRight++;
    if (!unsureHere && verdict === "parts_missing") partsMissing.push(side);
    if (humanCheck) needsHumanCheck.push(side);

    // Grouped right when this student's replay group and teacher group are
    // each the other's majority: the replay group is mostly this teacher
    // group, and this teacher group mostly landed in this replay group. One
    // student the replay set apart (Unsure, or credit the teacher split off)
    // is then that student's miss -- it used to make every classmate in the
    // group a miss too, so 2 Unsure of 52 scored "grouped 0%" (#124 review).
    const majorities = groupMajorities(e.questionId);
    const placed =
      majorities.replayToTeacher.get(replayKey(r)) === groupKey(e) &&
      majorities.teacherToReplay.get(groupKey(e)) === replayKey(r);
    // AND the same (or an equivalent) answer: a student alone in a group
    // otherwise "matches" the teacher's group of one whatever was read.
    if (!unsureHere && placed && (sameFinal || equivalent)) {
      inGroup++;
      continue;
    }
    if (unsureHere) misses.unsure++;
    else if (isBlank && !wantedBlank) misses.wrongly_blank++;
    // Read right (or equivalently) but grouped apart from its classmates.
    else if (equivalent || sameFinal) misses.equivalent_not_grouped++;
    else if (humanCheck) misses.needs_human_check++;
    else misses.wrong_final++;
  }
  // Per question and final answer: answers whose credit differs from the most
  // common credit for that answer.
  let creditSplits = 0;
  const byAnswer = new Map<string, string[]>();
  for (const e of expected) {
    const k = e.questionId + "\u0000" + groupKey(e);
    byAnswer.set(k, [...(byAnswer.get(k) ?? []), teacherKey(e)]);
  }
  for (const keys of byAnswer.values()) {
    const counts = new Map<string, number>();
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
    creditSplits += keys.length - Math.max(...counts.values());
  }
  const n = expected.length;
  // An answer waiting on a human check is not a miss, in either measure.
  const readAccuracy = ratio(readRight + needsHumanCheck.length, n);
  const groupAccuracy = ratio(inGroup + misses.needs_human_check, n);
  const decisive = kind === "grouping" ? groupAccuracy : readAccuracy;
  return {
    answers: n,
    readRight,
    readAccuracy,
    inGroup,
    groupAccuracy,
    creditSplits,
    wronglyCorrect,
    wronglyBlank: misses.wrongly_blank,
    missedCorrect,
    unsure,
    misses,
    partsReturned,
    partsExpected,
    partsMissing,
    needsHumanCheck,
    // The hard-fail rules are unchanged: any wrongly-correct or wrongly-blank
    // answer fails the case whatever the accuracy.
    passed: decisive >= PASS.answers && wronglyCorrect === 0 && misses.wrongly_blank === 0,
  };
}

export type ListScore = { items: number; right: number; accuracy: number; missing: number; passed: boolean };

/** A key answer shown side by side on the replay page. */
export type KeyItem = { number: number; read: string; expected: string };

export type KeyScore = ListScore & {
  /** Question numbers the read key got wrong: the real misses. */
  wrong: number[];
  /** Read faithfully but missing parts of the confirmed answer: listed apart
   * from `wrong`, but counted against the accuracy like it (the app would
   * grade students against an incomplete key). Not counted in `right`. */
  partsMissing: KeyItem[];
  /** Prose that cannot be compared: not a miss, for a person to judge. */
  needsHumanCheck: KeyItem[];
};

/** Answer key: the read key against the confirmed one, question by question
 * number, by value (judgeAnswer). Accuracy is the share that is neither wrong
 * nor missing parts: an answer waiting on a human check does not count against
 * it, an incomplete one does. */
export function scoreKey(
  expected: { number: number; answer: string }[],
  read: { number: number; answer: string }[],
): KeyScore {
  let right = 0;
  let missing = 0;
  const wrong: number[] = [];
  const partsMissing: KeyItem[] = [];
  const needsHumanCheck: KeyItem[] = [];
  for (const e of expected) {
    const r = read.find((q) => q.number === e.number);
    if (!r) {
      missing++;
      continue;
    }
    const item = { number: e.number, read: r.answer, expected: e.answer };
    const verdict = judgeAnswer(r.answer, e.answer);
    // An incomplete key answer is not "right": the app would grade against
    // it. It is not wrong either -- listed apart, as reading's are.
    if (verdict === "same") right++;
    else if (verdict === "parts_missing") partsMissing.push(item);
    else if (verdict === "needs_human_check") needsHumanCheck.push(item);
    else wrong.push(e.number);
  }
  // An incomplete key answer counts against the pass like a wrong one: the app
  // would grade every student against it. It is still listed apart.
  const accuracy = ratio(expected.length - wrong.length - missing - partsMissing.length, expected.length);
  return { items: expected.length, right, accuracy, missing, wrong, partsMissing, needsHumanCheck, passed: accuracy >= PASS.key };
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
