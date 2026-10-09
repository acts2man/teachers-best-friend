import type {
  AnswerRegion,
  Assessment,
  Group,
  Question,
  RubricDimension,
  Student,
  StudentResponse,
} from "./teacher-types";
import { provablyDifferent } from "./math-answer";
import {
  cognitiveReportLines,
  costaBreakdown,
  dokBreakdown,
  responseMatch,
} from "./teacher-metrics";

export function activeQuestions(a: Assessment) {
  return a.questions.filter((q) => !q.excluded);
}

/**
 * Active questions the read left without a standard. When a whole read comes
 * back like this (the model punted on a longer/multi-page test), the student-
 * work step stays locked because preparationGaps needs a standard on every
 * question. The UI uses this to tell the teacher and offer to assign one,
 * rather than leaving a silent 0% and a dead end.
 */
export function questionsMissingStandard(a: Assessment): Question[] {
  return activeQuestions(a).filter((q) => !q.standard);
}

/**
 * Assigns a standard to every active question that has none, leaving questions
 * that already have one untouched. Verification is unchanged: the teacher still
 * confirms each question, so this is a starting point (the standard they already
 * chose as intended), not a silent grade.
 */
export function assignStandardToUntagged(a: Assessment, code: string): Assessment {
  if (!code) return a;
  return {
    ...a,
    questions: a.questions.map((q) =>
      !q.excluded && !q.standard ? { ...q, standard: code } : q,
    ),
  };
}

export function preparationGaps(a: Assessment) {
  // Writing has no questions and no answer key -- the rubric is the whole setup.
  // It is ready to grade the moment it has a rubric with every trait filled in,
  // which the default always provides, so a fresh writing assessment is ready.
  if (a.rubric) {
    const dims = a.rubric.length;
    const incomplete = a.rubric.filter(
      (d) => !d.name.trim() || !(d.max > 0),
    ).length;
    return {
      questions: dims,
      standards: 0,
      answers: 0,
      targets: 0,
      keyConfirmed: true,
      ready: dims > 0 && incomplete === 0,
    };
  }
  const questions = activeQuestions(a);
  return {
    questions: questions.length,
    standards: questions.filter((q) => !q.verified || !q.standard).length,
    answers: questions.filter((q) => !q.answer.trim()).length,
    targets: a.targetStandards.length,
    keyConfirmed:
      a.answerKeyVerified === true ||
      (a.answerKeyVerified === undefined && a.source === "sample"),
    ready:
      questions.length > 0 &&
      a.targetStandards.length > 0 &&
      (a.answerKeyVerified === true ||
        (a.answerKeyVerified === undefined && a.source === "sample")) &&
      questions.every((q) => q.verified && q.standard && q.answer.trim()),
  };
}

export function responseFlag(
  response: StudentResponse,
  question?: Question,
): string | null {
  if (!question || question.excluded) return null;
  if (!question.verified || !question.answer.trim())
    return "Check the assignment or answer key";
  if (!response.answer.trim()) return "Missing answer";
  if (response.confidence < 90)
    return "Reading or interpretation needs a check";
  if (responseMatch(response) < 100)
    return responseMatch(response) + "% match with the key and standard";
  if (!response.correct) return "Answer differs from the key";
  return null;
}

/**
 * A clean AI match: correct, a full match, read confidently (>=90%), non-blank,
 * on a question whose standard and key are confirmed. It is exactly an answer
 * with nothing left to flag (responseFlag === null) on an active question.
 *
 * Michael: an answer the AI matched to the key should not need a second
 * confirmation to count. Because this is the no-flag case, it can never be a
 * blank (those flag "Missing answer"), an unsure/low-confidence read (those flag
 * a check), or a wrong answer -- and #108 already demotes a "match" whose value
 * differs from the key to correct:false/confidence:0, so a false match never
 * reaches here. So counting these needs no second tap and still never weakens
 * the Unsure group or the never-auto-score-blank rule.
 */
export function isCleanAiMatch(a: Assessment, r: StudentResponse): boolean {
  const q = a.questions.find((x) => x.id === r.questionId);
  return !!q && !q.excluded && responseFlag(r, q) === null;
}

/**
 * Whether an answer counts toward the score and completion right now: the
 * teacher confirmed it, OR it is a clean AI match that needs no confirmation.
 * Opening a clean match to change it (giving it other credit) verifies it at the
 * teacher's chosen credit, which still counts.
 */
export function countsAsGraded(a: Assessment, r: StudentResponse): boolean {
  return r.verified || isCleanAiMatch(a, r);
}

/**
 * What one question is worth.
 *
 * Ricky: some questions are worth more than others, and teachers expect to set
 * that. A question's own `points` wins. Without it the assessment's total (the
 * old single "points possible" number) is split evenly, and without that each
 * question is worth 1 -- so every assessment made before points existed scores
 * exactly as it did.
 */
export function questionPoints(a: Assessment, q: Question): number {
  if (typeof q.points === "number" && q.points > 0) return q.points;
  // What is left of the total once questions with their own points are
  // counted, shared by the rest -- so a question added after points were set
  // does not quietly take a share meant for the others.
  const active = activeQuestions(a);
  const own = active.filter((x) => typeof x.points === "number" && x.points > 0);
  const rest = active.length - own.length;
  const left = (a.pointsPossible ?? 0) - own.reduce((sum, x) => sum + (x.points as number), 0);
  if (a.pointsPossible && a.pointsPossible > 0 && rest > 0 && left > 0)
    return Math.round((left / rest) * 100) / 100;
  return 1;
}

/** What the whole assessment is worth: the sum of its questions. */
export function totalPoints(a: Assessment): number {
  return roundPoints(activeQuestions(a).reduce((sum, q) => sum + questionPoints(a, q), 0));
}

/** Points to two decimals, so 1/3 + 1/3 + 1/3 shows as 1, not 0.9999. */
export function roundPoints(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "3", "1.5", "0.33" -- no trailing zeros. */
export function pointsText(n: number): string {
  return String(roundPoints(n));
}

/** Points earned on one answer: its credit (a percentage of the question)
 * times what the question is worth. 3 of 4 is stored as 75%, so changing a
 * question's worth later keeps the same share of credit. */
export function pointsEarned(a: Assessment, r: StudentResponse): number {
  const q = a.questions.find((x) => x.id === r.questionId);
  if (!q) return 0;
  return roundPoints((responseMatch(r) / 100) * questionPoints(a, q));
}

/**
 * Sets one question's worth. The first time any question is given its own
 * points, every question gets its current worth written down, so the others do
 * not shift when this one changes; the total becomes the sum.
 */
export function setQuestionPoints(a: Assessment, questionId: string, points: number): Assessment {
  const value = roundPoints(Math.max(0, Math.min(1000, points)));
  const questions = a.questions.map((q) => ({
    ...q,
    points: q.id === questionId ? value : questionPoints(a, q),
  }));
  const next = { ...a, questions };
  return { ...next, pointsPossible: totalPoints(next) };
}

/** The credit, as a percentage of the question, for `earned` points of it. */
export function creditForPoints(a: Assessment, q: Question, earned: number): number {
  const worth = questionPoints(a, q);
  if (worth <= 0) return 0;
  return Math.max(0, Math.min(100, (earned / worth) * 100));
}

export function studentReview(a: Assessment, studentId: string) {
  const questions = activeQuestions(a);
  const responses = questions.flatMap((q) => {
    const response = a.responses.find(
      (r) => r.studentId === studentId && r.questionId === q.id,
    );
    return response ? [response] : [];
  });
  const pending = responses.filter((r) => !r.verified);
  const flagged = pending.filter((r) =>
    responseFlag(
      r,
      questions.find((q) => q.id === r.questionId),
    ),
  );
  const clear = pending.filter(
    (r) =>
      !responseFlag(
        r,
        questions.find((q) => q.id === r.questionId),
      ),
  );
  const reviewed = responses.filter((r) => r.verified);
  // Answers that count toward the score now: confirmed by the teacher, or a
  // clean AI match that needs no confirmation (Michael). `reviewed` stays the
  // teacher-confirmed set (the depth breakdown reflects what they actually
  // reviewed); `counted` drives the score, completion and the gradebook.
  const counted = responses.filter((r) => countsAsGraded(a, r));
  const missing = questions.filter(
    (q) => !responses.some((r) => r.questionId === q.id),
  );
  const complete =
    questions.length > 0 &&
    missing.length === 0 &&
    counted.length === questions.length;
  // Every answer the teacher has actually CONFIRMED (not just a clean AI match).
  // Deleting a student's scanned pages keys off this, never off the auto-count:
  // a page is released only once the teacher has explicitly signed off on all of
  // that student's answers, so nothing a clean match "counts" is thrown away
  // before they have looked.
  const allConfirmed =
    questions.length > 0 &&
    missing.length === 0 &&
    reviewed.length === questions.length;
  return {
    questions,
    responses,
    pending,
    flagged,
    clear,
    reviewed,
    counted,
    missing,
    complete,
    allConfirmed,
    // Answers that still need the teacher: pending AND not a clean AI match.
    // A clean match counts on its own, so it is not "waiting"; a blank, an
    // unsure read or a wrong answer still is. Not counted as zero in the score
    // -- surfaced so a partial score is never mistaken for a final one.
    needsGrading: pending.filter((r) => !isCleanAiMatch(a, r)).length,
    // Weighted by what each question is worth: points earned over points
    // possible, across the answers that count so far (confirmed or clean match).
    // With every question worth the same this is the plain average it always was.
    score: counted.length ? Math.round((100 * earnedOf(counted)) / possibleOf(counted)) : null,
    pointsEarned: roundPoints(earnedOf(counted)),
    pointsPossible: totalPoints(a),
  };
  function earnedOf(rs: StudentResponse[]) {
    return rs.reduce((sum, r) => sum + pointsEarned(a, r), 0);
  }
  function possibleOf(rs: StudentResponse[]) {
    const total = rs.reduce((sum, r) => {
      const q = questions.find((x) => x.id === r.questionId);
      return sum + (q ? questionPoints(a, q) : 0);
    }, 0);
    return total > 0 ? total : 1;
  }
}

export function assignmentNextStep(a: Assessment) {
  const prep = preparationGaps(a);
  // Writing has no questions/targets/answer key to chase: once the rubric is in
  // place (it always is), the only step is adding and reviewing student writing.
  if (a.rubric) {
    if (a.responses.some((r) => !r.verified))
      return {
        label: "Review student writing",
        href: "/assessments?id=" + a.id + "&tab=responses",
      };
    return {
      label: "Add student writing",
      href: "/assessments?id=" + a.id + "&tab=responses",
    };
  }
  if (!prep.questions)
    return {
      label: "Add questions",
      href: "/assessments?id=" + a.id + "&tab=questions",
    };
  if (!prep.targets)
    return {
      label: "Choose intended standards",
      href: "/assessments?id=" + a.id + "&tab=coverage",
    };
  if (prep.standards)
    return {
      label: "Review alignment",
      href: "/assessments?id=" + a.id + "&tab=questions",
    };
  if (prep.answers || !prep.keyConfirmed)
    return {
      label: "Confirm answer key",
      href: "/assessments?id=" + a.id + "&tab=key",
    };
  if (a.responses.some((r) => !r.verified))
    return {
      label: "Review student work",
      href: "/assessments?id=" + a.id + "&tab=responses",
    };
  return {
    label: "Add student work",
    href: "/assessments?id=" + a.id + "&tab=responses",
  };
}

export function applyAnswerKey(
  a: Assessment,
  answers: Record<string, string>,
): Assessment {
  const changed = new Set(
    a.questions
      .filter(
        (q) =>
          answers[q.id] !== undefined &&
          answers[q.id].trim() !== q.answer.trim(),
      )
      .map((q) => q.id),
  );
  return {
    ...a,
    answerKeyVerified: changed.size ? false : a.answerKeyVerified,
    questions: a.questions.map((q) =>
      answers[q.id] === undefined ? q : { ...q, answer: answers[q.id].trim() },
    ),
    responses: a.responses.map((r) =>
      changed.has(r.questionId)
        ? { ...r, verified: false, confidence: 0, match: 0, errorType: "" }
        : r,
    ),
  };
}

export function parseAnswerKey(text: string, questions: Question[]) {
  const answers: Record<string, string> = {};
  const entries = text.split(/\n(?=\s*(?:Q(?:uestion)?\s*)?\d+[.):\-]\s*)/i);
  for (const entry of entries) {
    const match = entry
      .trim()
      .match(/^(?:Q(?:uestion)?\s*)?(\d+)[.):\-]\s*([\s\S]+)$/i);
    if (!match) continue;
    const question = questions.find((q) => q.number === Number(match[1]));
    if (question && match[2].trim()) answers[question.id] = match[2].trim();
  }
  return answers;
}

/**
 * What the AI returns per graded question now: the transcribed answer and one
 * verdict. It no longer guesses a partial score or a misconception -- "other"
 * is the answer that goes to the teacher to decide.
 */
export type RecognizedResponse = {
  questionId: string;
  answer: string;
  verdict: "match" | "blank" | "other" | "unsure";
  /** See StudentResponse.finalAnswer / answerRegion / suggestedErrorType. */
  finalAnswer?: string;
  answerRegion?: AnswerRegion | null;
  suggestedErrorType?: string;
};

/**
 * Maps the AI's verdicts onto StudentResponses.
 *
 * The AI decides three things and only three: a clean "match" is full credit
 * (correct, match 100), a "blank" is zero, and everything else is "other" --
 * which carries NO score. Its match is left unset so it shows as unresolved and
 * surfaces in Grade by question for the teacher to decide, rather than the app
 * inventing a partial the AI was told not to guess. A question the AI did not
 * report (or reported twice) is treated as blank and flagged for a look.
 */
export function normalizeRecognizedResponses(
  a: Assessment,
  studentId: string,
  incoming: RecognizedResponse[],
): StudentResponse[] {
  return activeQuestions(a).map((q) => {
    const matches = incoming.filter((r) => r.questionId === q.id);
    const response = matches.length === 1 ? matches[0] : undefined;
    const final = response?.finalAnswer?.trim() || response?.answer || "";
    // Ricky's rule: never marked correct when it is wrong. A "match" whose
    // final answer provably differs from the key by value -- a sign, a missing
    // variable -- is not trusted; it goes to the teacher as unsure.
    const contradictsKey =
      response?.verdict === "match" && !!final && provablyDifferent(final, q.answer);
    // And never marked blank when the page shows work. A question the model
    // left out, reported twice, or was not sure about is UNSURE -- for the
    // teacher, not scored zero. (A model skipping questions in a long batch is
    // what put Michael's students with work in a "blank" group on 8 Oct.)
    const unsure = !response || response.verdict === "unsure" || contradictsKey;
    const isMatch = response?.verdict === "match" && !contradictsKey;
    const isBlank = !unsure && response?.verdict === "blank";
    return {
      id: crypto.randomUUID(),
      studentId,
      questionId: q.id,
      answer: isBlank ? "" : response?.answer || "",
      correct: isMatch,
      // match 100 for a clean match, 0 for a blank, and UNSET for "other" and
      // "unsure" so no score is invented -- responseMatch reads unset as 0 for
      // the running total while groupAnswers still surfaces it for a decision.
      // A blank is scored zero but NOT confirmed: the teacher sees the photo
      // of an empty answer before it counts.
      match: isMatch ? 100 : isBlank ? 0 : undefined,
      misconception:
        matches.length > 1
          ? "More than one answer was recognized. Check the original work."
          : matches.length === 0
            ? "No answer came back for this question. Check the original work."
            : contradictsKey
              ? "Read as matching the key, but the value differs. Check the original work."
              : "",
      // Confidence is binary: 100 when the model read and judged the answer,
      // 0 when the teacher has to look (the Unsure group in Grade by question).
      confidence: unsure ? 0 : 100,
      verified: false,
      ...(!isBlank && response?.finalAnswer?.trim()
        ? { finalAnswer: response.finalAnswer.trim() }
        : {}),
      ...(response?.answerRegion ? { answerRegion: response.answerRegion } : {}),
      ...(!isBlank && !isMatch && response?.suggestedErrorType
        ? { suggestedErrorType: response.suggestedErrorType }
        : {}),
    };
  });
}

/** The AI's suggested rubric scores for one essay: a level and a one-line reason
 * per dimension id. */
export type WritingScore = {
  dimensionId: string;
  score: number;
  reason: string;
};

/** The rubric dimensions of a writing assessment, or [] for any other kind. */
export function rubricDimensions(a: Assessment): RubricDimension[] {
  return a.rubric ?? [];
}

/**
 * Maps the AI's suggested rubric scores onto StudentResponses -- one per rubric
 * dimension, keyed by the dimension id (there are no questions on a writing
 * assessment). Each score is clamped to that dimension's own max; `match` carries
 * the percentage so mastery and the gradebook read it like any other response,
 * while `rubricScore` keeps the raw level the teacher sees. Nothing is verified:
 * these are suggestions the teacher confirms or changes. A dimension the AI did
 * not score comes back unscored (match unset) so the teacher must set it.
 */
export function normalizeWritingScores(
  a: Assessment,
  studentId: string,
  incoming: WritingScore[],
): StudentResponse[] {
  return rubricDimensions(a).map((d) => {
    const got = incoming.find((s) => s.dimensionId === d.id);
    const max = d.max > 0 ? d.max : 4;
    const scored = got ? Math.max(0, Math.min(max, Math.round(got.score))) : undefined;
    return {
      id: crypto.randomUUID(),
      studentId,
      questionId: d.id,
      answer: "",
      correct: scored !== undefined && scored >= max,
      // Percentage for mastery/gradebook; unset when the AI skipped it so it
      // shows as still needing the teacher's score rather than a silent zero.
      match: scored === undefined ? undefined : Math.round((scored / max) * 100),
      rubricScore: scored,
      rubricReason: got?.reason || "",
      misconception: "",
      confidence: got ? 100 : 0,
      verified: false,
    };
  });
}

/** One rubric row for one student: the dimension and the response holding its
 * score (or undefined when the essay has not been scored yet). */
export type WritingRow = {
  dimension: RubricDimension;
  response?: StudentResponse;
};

/** The rubric rows for one student, in rubric order. */
export function writingRows(a: Assessment, studentId: string): WritingRow[] {
  return rubricDimensions(a).map((dimension) => ({
    dimension,
    response: a.responses.find(
      (r) => r.studentId === studentId && r.questionId === dimension.id,
    ),
  }));
}

/** True once this student has a scored response for every rubric dimension. */
export function writingScored(a: Assessment, studentId: string): boolean {
  const rows = writingRows(a, studentId);
  return rows.length > 0 && rows.every((r) => r.response?.rubricScore !== undefined);
}

/** True once the teacher has confirmed every rubric dimension for this student. */
export function writingConfirmed(a: Assessment, studentId: string): boolean {
  const rows = writingRows(a, studentId);
  return rows.length > 0 && rows.every((r) => r.response?.verified);
}

/** Swaps in a fresh set of AI-suggested scores for one student, dropping any it
 * had before for this assessment's rubric. */
export function replaceWritingResponses(
  a: Assessment,
  studentId: string,
  incoming: StudentResponse[],
): Assessment {
  const dimIds = new Set(rubricDimensions(a).map((d) => d.id));
  return {
    ...a,
    responses: [
      ...a.responses.filter(
        (r) => !(r.studentId === studentId && dimIds.has(r.questionId)),
      ),
      ...incoming,
    ],
  };
}

/** Sets one dimension's level for one student and confirms that row. The level
 * is clamped to the dimension's max; `match` carries the percentage so mastery
 * and the gradebook read it like any other response. */
export function setWritingScore(
  a: Assessment,
  studentId: string,
  dimensionId: string,
  score: number,
): Assessment {
  const dimension = rubricDimensions(a).find((d) => d.id === dimensionId);
  if (!dimension) return a;
  const max = dimension.max > 0 ? dimension.max : 4;
  const level = Math.max(0, Math.min(max, Math.round(score)));
  return {
    ...a,
    responses: a.responses.map((r) =>
      r.studentId === studentId && r.questionId === dimensionId
        ? {
            ...r,
            rubricScore: level,
            match: Math.round((level / max) * 100),
            correct: level >= max,
            verified: true,
          }
        : r,
    ),
  };
}

/** Confirms every scored dimension for one student at its current level, so the
 * teacher can accept the AI's suggestions in one step. A dimension the AI left
 * unscored is skipped -- it still needs a level. */
export function confirmWritingScores(a: Assessment, studentId: string): Assessment {
  const dimIds = new Set(rubricDimensions(a).map((d) => d.id));
  return {
    ...a,
    responses: a.responses.map((r) =>
      r.studentId === studentId &&
      dimIds.has(r.questionId) &&
      r.rubricScore !== undefined
        ? { ...r, verified: true }
        : r,
    ),
  };
}

/**
 * Layers a fresh pass of recognized responses over what this student already
 * had, keeping the earlier answer wherever the new pass found nothing.
 *
 * A teacher who photographs page 2 after page 1 sends a request that can only
 * see page 2, so it truthfully reports every question that lives on page 1 as
 * not visible. Replacing outright threw page 1's answers away and showed the
 * teacher half a blank test. Keeping the earlier answer where the new pass is
 * empty joins the pages instead. Re-scanning the same page still overwrites
 * it, because that pass does find those questions.
 */
export function mergeStudentResponses(
  existing: StudentResponse[],
  incoming: StudentResponse[],
): StudentResponse[] {
  const before = new Map(existing.map((r) => [r.questionId, r]));
  return incoming.map((r) => {
    const prior = before.get(r.questionId);
    return !r.answer.trim() && prior?.answer.trim() ? prior : r;
  });
}

/**
 * Points earned for a whole-test percentage, out of what the assessment is
 * worth. Rounded to the nearest whole point, halves up (Math.round): a grade
 * book counts whole points, and the percentage shown beside it stays the exact
 * figure. Returns null when there is no score or no points total set.
 */
export function pointsForScore(
  score: number | null,
  pointsPossible?: number,
): number | null {
  if (score === null || !pointsPossible || pointsPossible <= 0) return null;
  return Math.round((score / 100) * pointsPossible);
}

/**
 * A whole-test score for display: "90%", or "90% · 18/20" when the assessment
 * has a points total. "—" when there is no score yet.
 */
export function scoreLabel(
  score: number | null,
  pointsPossible?: number,
): string {
  if (score === null) return "—";
  const pts = pointsForScore(score, pointsPossible);
  return pts === null ? `${score}%` : `${score}% · ${pts}/${pointsPossible}`;
}

/** DOK and Costa breakdowns for one student's reviewed answers, or "" if none. */
function studentCognitiveSection(a: Assessment, reviewed: StudentResponse[]): string {
  const dok = dokBreakdown(a.questions, reviewed);
  const costa = costaBreakdown(a.questions, reviewed);
  if (!dok.length && !costa.length) return "";
  let out = "\n\nCOGNITIVE DEMAND";
  if (dok.length) out += "\nBy Webb DOK\n" + cognitiveReportLines(dok);
  if (costa.length) out += "\nBy Costa's level\n" + cognitiveReportLines(costa);
  return out;
}

/** The error types tagged on one student's reviewed answers, most common first. */
function studentErrorSection(reviewed: StudentResponse[]): string {
  const counts = new Map<string, number>();
  for (const r of reviewed) {
    const errorType = (r.errorType || "").trim();
    if (!errorType) continue;
    counts.set(errorType, (counts.get(errorType) || 0) + 1);
  }
  if (!counts.size) return "";
  return (
    "\n\nMOST COMMON ERROR TYPES\n" +
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([errorType, count]) => errorType + " (" + count + ")")
      .join("\n")
  );
}

export function studentReport(a: Assessment, student: Student) {
  const summary = studentReview(a, student.id);
  const codes = [
    ...new Set(summary.questions.map((q) => q.standard).filter(Boolean)),
  ];
  return (
    a.title +
    "\nStudent: " +
    student.name +
    "\nGrade " +
    a.grade +
    " · " +
    a.subject +
    " · " +
    a.framework +
    "\nReview: " +
    summary.reviewed.length +
    " of " +
    summary.questions.length +
    " answers confirmed" +
    "\n" +
    (summary.complete
      ? "Confirmed assignment score: "
      : "Provisional score from reviewed answers: ") +
    (summary.score === null
      ? "Not yet available"
      : summary.score +
        "% · " +
        pointsText(summary.pointsEarned) +
        "/" +
        pointsText(summary.pointsPossible) +
        " points") +
    "\n\nSTANDARDS EVIDENCE\n" +
    codes
      .map((code) => {
        const qs = summary.questions.filter((q) => q.standard === code);
        const rs = summary.reviewed.filter((r) =>
          qs.some((q) => q.id === r.questionId),
        );
        const match = rs.length
          ? Math.round(
              rs.reduce((sum, response) => sum + responseMatch(response), 0) /
                rs.length,
            )
          : null;
        return `${code}: ${match === null ? "no reviewed match" : match + "% average answer match"}; ${rs.filter((r) => r.correct).length} fully correct of ${rs.length} reviewed; ${qs.length} questions assigned.`;
      })
      .join("\n") +
    studentCognitiveSection(a, summary.reviewed) +
    studentErrorSection(summary.reviewed) +
    "\n\nQUESTION REVIEW\n" +
    summary.questions
      .map((q) => {
        const r = summary.responses.find((r) => r.questionId === q.id);
        return (
          "Q" +
          q.number +
          " · " +
          q.standard +
          "\n" +
          q.text +
          "\nExpected: " +
          q.answer +
          "\nStudent answer: " +
          (r?.answer || "Not recorded") +
          "\nStatus: " +
          (!r?.verified
            ? "Pending teacher review"
            : r.correct
              ? "Correct"
              : "Needs support") +
          (r?.misconception ? "\nObservation: " + r.misconception : "")
        );
      })
      .join("\n\n") +
    "\n\nThis report describes this assignment. One assignment does not establish long-term mastery."
  );
}

/**
 * The scanned pages that have done their job and can be deleted.
 *
 * Both pilot teachers asked for student work photos to be deleted "after class
 * analysis is generated". There is no such event -- class analysis is computed
 * live from whatever grading has been confirmed, every time the tab is opened.
 * The equivalent moment that does exist is per student: once every question of
 * a student's work has been reviewed and confirmed, the photograph has given up
 * everything it had, and the grades stand on their own.
 *
 * Only pages under studentUploadIds are considered, so the blank assessment and
 * the answer key are never touched -- those are the teacher's own documents, not
 * a child's handwriting. A page is held back if any student whose review is not
 * finished still points at it, so a shared or mis-assigned page is never deleted
 * out from under work that is still in progress.
 */
export function releasedStudentUploads(a: Assessment): string[] {
  const byStudent = a.studentUploadIds || {};
  const done = new Set<string>();
  const held = new Set<string>();
  for (const [studentId, ids] of Object.entries(byStudent)) {
    const target = studentReview(a, studentId).allConfirmed ? done : held;
    for (const id of ids || []) target.add(id);
  }
  return [...done].filter((id) => !held.has(id));
}

/**
 * The assessment with those pages unlinked. Call alongside the delete so the
 * app stops offering a thumbnail for a file that is no longer there.
 */
export function forgetUploads(a: Assessment, released: string[]): Assessment {
  if (!released.length) return a;
  const gone = new Set(released);
  const studentUploadIds = Object.fromEntries(
    Object.entries(a.studentUploadIds || {}).map(([studentId, ids]) => [
      studentId,
      (ids || []).filter((id) => !gone.has(id)),
    ]),
  );
  return {
    ...a,
    studentUploadIds,
    uploadIds: a.uploadIds.filter((id) => !gone.has(id)),
  };
}

/** One cluster of students who answered a question the same way. */
/** The key of a question's Unsure group. */
export const UNSURE_KEY = "\u0000unsure";

export type AnswerGroup = {
  key: string;
  /** The answers the model was not sure about, or skipped, for this question:
   * one group, whatever each student wrote, graded student by student. */
  unsure?: boolean;
  answer: string;
  responseIds: string[];
  studentIds: string[];
  /** True when every response here already matches the key outright. */
  correct: boolean;
  match: number;
  /** True when the teacher has confirmed every response here (at any score). */
  verified: boolean;
  needsDecision: boolean;
  /** The error type the teacher tagged this group with, or "" when untagged or
   * when the responses here disagree (which normal use never produces, since a
   * tag is applied to the whole group at once). */
  errorType: string;
  /** The error type the grading pass suggested most often in this group, or
   * "" -- offered to the teacher to approve or change, never applied alone. */
  suggestedErrorType: string;
  /** How the students actually wrote it, up to three different ways, so the
   * teacher sees "11,163 people" and "5,753 + 2,250 + 3,160 = 11,163" behind
   * a group labelled 11163. */
  written: string[];
};

/**
 * One question at a glance, before opening its groups (Ricky's flow): how many
 * answers are right, how many are blank or got no credit, how many got part
 * credit, and how many still need the teacher. Counted in students.
 */
export type QuestionSummary = {
  correct: number;
  noCredit: number;
  partial: number;
  needReview: number;
  /** Answer groups still waiting on a decision. */
  groupsToReview: number;
  /** Of those needing review, how many the model was unsure about. */
  unsure: number;
};

export function questionSummary(a: Assessment, questionId: string): QuestionSummary {
  const groups = groupAnswers(a, questionId);
  const summary: QuestionSummary = { correct: 0, noCredit: 0, partial: 0, needReview: 0, groupsToReview: 0, unsure: 0 };
  for (const g of groups) {
    if (g.unsure) summary.unsure += g.responseIds.length;
    if (g.needsDecision) {
      summary.needReview += g.responseIds.length;
      summary.groupsToReview++;
      continue;
    }
    const m = Math.round(g.match);
    if (!g.answer.trim() || m <= 0) summary.noCredit += g.responseIds.length;
    else if (m >= 100) summary.correct += g.responseIds.length;
    else summary.partial += g.responseIds.length;
  }
  return summary;
}

/** The short label for a credit score, matching the Grade-by-question buttons. */
export function creditLabel(match: number): string {
  const level = CREDIT_LEVELS.find((l) => l.value === match);
  return level ? level.label : `${match}%`;
}

/**
 * Compares two written answers the way a teacher scanning a pile does: case,
 * surrounding space, trailing punctuation and the difference between "65%" and
 * "65 %" are not different answers. Deliberately conservative -- it will split
 * two answers a teacher would have merged rather than merge two they would have
 * kept apart, because a wrong merge assigns a grade nobody looked at.
 */
export function answerKey(answer: string) {
  return answer
    .toLowerCase()
    .replace(/[\s,]+/g, "")
    .replace(/[.;:!]+$/, "")
    .trim();
}

/**
 * Every distinct answer given to one question, with the students who gave it.
 *
 * This is what makes grading a class set by question rather than by student
 * worth doing: thirty-six papers hold far fewer than thirty-six different
 * answers, and the ones that repeat need deciding once, not once per child. It
 * costs nothing extra -- every answer here was already read during grading, so
 * this is sorting work we have already paid for, not a second look.
 *
 * Groups are ordered largest first, so the decision that clears the most papers
 * is the one on top. `needsDecision` marks the ones worth a teacher's attention:
 * a blank scores zero and an outright match scores full credit on their own.
 */
export function groupAnswers(
  a: Assessment,
  questionId: string,
): AnswerGroup[] {
  const question = a.questions.find((q) => q.id === questionId);
  const groups = new Map<string, AnswerGroup>();
  // Within a group, students are listed in the order their papers were
  // scanned, which is the order of the pile on the teacher's desk.
  const at = new Map((a.studentOrder ?? []).map((id, i) => [id, i]));
  const rank = (id: string) => at.get(id) ?? Number.MAX_SAFE_INTEGER;
  const inOrder = a.responses
    .filter((r) => r.questionId === questionId)
    .map((r, i) => ({ r, i }))
    .sort((x, y) => rank(x.r.studentId) - rank(y.r.studentId) || x.i - y.i)
    .map(({ r }) => r);
  const suggestions = new Map<string, Map<string, number>>();
  for (const r of inOrder) {
    // Grouped on the final answer the grading pass normalized ("11163"), not
    // the whole written text, so students who reached the same answer by
    // writing it differently are one decision. Answers graded before the final
    // answer existed fall back to their written text, as before.
    const final = r.finalAnswer?.trim() || r.answer;
    // Not yet decided and the model was unsure (or skipped it): one Unsure
    // group per question, whatever was written, for the teacher to look at.
    const unsure = !r.verified && r.confidence < 50;
    // Once the teacher has graded an answer it groups with answers given the
    // SAME credit -- so pulling one student out and grading them on their own
    // gives them their own group rather than dragging the rest along.
    const key = unsure
      ? UNSURE_KEY
      : answerKey(final) + (r.verified ? "|" + Math.round(responseMatch(r)) : "");
    if (r.suggestedErrorType) {
      const tally = suggestions.get(key) ?? new Map<string, number>();
      tally.set(r.suggestedErrorType, (tally.get(r.suggestedErrorType) ?? 0) + 1);
      suggestions.set(key, tally);
    }
    const existing = groups.get(key);
    if (existing) {
      if (r.answer.trim() && existing.written.length < 3 && !existing.written.includes(r.answer.trim()))
        existing.written.push(r.answer.trim());
      existing.responseIds.push(r.id);
      existing.studentIds.push(r.studentId);
      existing.correct = existing.correct && r.correct;
      existing.verified = existing.verified && r.verified;
      existing.match = Math.min(existing.match, responseMatch(r));
      // The group's tag is the one its responses share; a disagreement (which
      // tagging the whole group at once never creates) collapses to untagged.
      if (existing.errorType !== (r.errorType || "")) existing.errorType = "";
      continue;
    }
    groups.set(key, {
      key,
      answer: final,
      responseIds: [r.id],
      studentIds: [r.studentId],
      correct: r.correct,
      verified: r.verified,
      match: responseMatch(r),
      needsDecision: false,
      errorType: r.errorType || "",
      suggestedErrorType: "",
      written: r.answer.trim() ? [r.answer.trim()] : [],
    });
  }
  for (const [key, tally] of suggestions) {
    const g = groups.get(key);
    if (g) g.suggestedErrorType = [...tally.entries()].sort((x, y) => y[1] - x[1])[0][0];
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      // A group needs a decision only while it is unsettled. A blank scores
      // zero and a clean match scores full credit on their own — and, crucially,
      // once the teacher has confirmed every response here (at ANY score, Half
      // or No credit included) the group is decided and must stop counting.
      // The old check looked only at correct && match>=100, so a group settled
      // below full credit stayed "to decide" forever — the bug Ricky hit.
      // Blank answers are decisions too now: the teacher sees the photo
      // before an empty answer is scored zero.
      needsDecision:
        !!question &&
        !question.excluded &&
        !g.verified &&
        !(g.correct && g.match >= 100 && g.key !== UNSURE_KEY),
      unsure: g.key === UNSURE_KEY,
      answer: g.key === UNSURE_KEY ? "" : g.answer,
    }))
    .sort((x, y) => y.responseIds.length - x.responseIds.length);
}

/**
 * Applies one decision to every response in a group at once: the match score
 * the teacher chose, marked correct at full credit, and confirmed so it stops
 * asking. The misconception text the AI wrote is left alone -- the teacher
 * changed the grade, not the diagnosis.
 */
/**
 * The credit a teacher can give an answer in one tap.
 *
 * Three clean presets — the six-button version read as too messy — with any
 * other value reachable through the separate "Percent" entry (0–100). Every
 * value is a plain percentage stored in `response.match` (see applyGroupScore),
 * so a 25/75/90 already graded on the old scale keeps its score and simply
 * shows as that percent; nothing here is a new data shape and no migration is
 * needed. Only 100 counts as fully correct — everything below is partial.
 */
export const CREDIT_LEVELS: { value: number; label: string }[] = [
  { value: 0, label: "No credit" },
  { value: 50, label: "Half" },
  { value: 100, label: "Full" },
];

export function applyGroupScore(
  a: Assessment,
  responseIds: string[],
  match: number,
  errorType?: string,
): Assessment {
  const ids = new Set(responseIds);
  const score = Math.max(0, Math.min(100, Math.round(match)));
  return {
    ...a,
    responses: a.responses.map((r) =>
      ids.has(r.id)
        ? {
            ...r,
            match: score,
            correct: score >= 100,
            verified: true,
            // Full credit is never an error, so it carries no error type.
            // Otherwise keep whatever tag the caller passed, or the group's
            // existing one when the caller passed none (a re-score at the same
            // credit should not silently drop the tag).
            errorType: score >= 100 ? "" : errorType ?? r.errorType,
          }
        : r,
    ),
  };
}

/**
 * Tags every response in a group with an error type (or clears it with ""),
 * without touching the score or the confirmation. This is the "changeable"
 * half of the feature: a teacher can add, change, or remove the tag on an
 * already-decided group at any time.
 */
export function setGroupErrorType(
  a: Assessment,
  responseIds: string[],
  errorType: string,
): Assessment {
  const ids = new Set(responseIds);
  return {
    ...a,
    responses: a.responses.map((r) =>
      ids.has(r.id) ? { ...r, errorType } : r,
    ),
  };
}

/**
 * Responses that need no per-group judgement — a blank (scored zero) or a clean
 * match (full credit) — but haven't been confirmed yet, so they aren't counted.
 * These are exactly what "Confirm the matching answers" settles from inside
 * Grade by question, so the flow is self-contained rather than sending the
 * teacher hunting for the confirm button in the per-student review.
 */
export function autoGradedToConfirm(a: Assessment): string[] {
  const active = new Map(activeQuestions(a).map((q) => [q.id, q]));
  return a.responses
    .filter((r) => {
      if (r.verified || !active.has(r.questionId)) return false;
      // Clean matches only. A blank is no longer confirmed in bulk: the
      // teacher sees the photo of an empty answer first (Ricky: never marked
      // blank when the page shows work), and an unsure answer is never a match.
      return r.correct && responseMatch(r) >= 100 && r.confidence >= 50;
    })
    .map((r) => r.id);
}

/** Confirm (verify) responses at their current score, without changing it. */
export function confirmResponses(a: Assessment, responseIds: string[]): Assessment {
  const ids = new Set(responseIds);
  return {
    ...a,
    responses: a.responses.map((r) => (ids.has(r.id) ? { ...r, verified: true } : r)),
  };
}

/** Escapes one CSV field. Excel and Sheets both treat a doubled quote inside
 * quotes as a literal quote, which is the only escaping either needs. */
function csvField(value: unknown) {
  return '"' + String(value ?? "").replace(/"/g, '""') + '"';
}

/**
 * The gradebook export: one row per student, one column per question, plus the
 * score out of a hundred.
 *
 * Every teacher using this ends up retyping these numbers into whatever their
 * district runs -- PowerSchool, Infinite Campus, a spreadsheet -- because that
 * is where grades legally live. The app already knows every number; not being
 * able to get them out is the difference between saving an evening and adding
 * one. It costs nothing: this is arithmetic over answers already graded.
 *
 * Only confirmed answers count toward the score, matching what the class
 * analysis does and what the teacher was told: a grade they have not looked at
 * is not a grade yet. `Reviewed` says how far along each student is, so a
 * half-checked class is obvious in the file rather than quietly understated.
 */
export function gradebookCsv(a: Assessment, students: Student[]) {
  const questions = activeQuestions(a);
  const total = totalPoints(a);
  // Each question column is the points earned on it, headed with what it is
  // worth, so a district gradebook gets the numbers the teacher set.
  const header = [
    "Student",
    ...questions.map((q) => "Q" + q.number + " (" + pointsText(questionPoints(a, q)) + " pts)"),
    "Points (of " + pointsText(total) + ")",
    "Score %",
    "Reviewed",
    "Needs grading",
  ];
  const rows = students.map((student) => {
    const review = studentReview(a, student.id);
    const byQuestion = new Map(review.responses.map((r) => [r.questionId, r]));
    // Until every answer is graded, the totals are not a final score, so they
    // are marked "Incomplete" rather than printing a partial as if it were the
    // result. The per-question columns still show what has been graded, and the
    // count of answers still waiting is its own column.
    const final = review.score !== null && review.complete;
    const incomplete = review.score !== null && !review.complete;
    return [
      student.name,
      ...questions.map((q) => {
        const r = byQuestion.get(q.id);
        // A clean AI match counts without a confirmation (Michael), so it prints
        // its points here too -- consistent with the on-screen score.
        if (!r || !countsAsGraded(a, r)) return "";
        return pointsText(pointsEarned(a, r));
      }),
      final ? pointsText(review.pointsEarned) : incomplete ? "Incomplete" : "",
      final ? String(review.score) : incomplete ? "Incomplete" : "",
      review.counted.length + "/" + questions.length,
      review.needsGrading ? String(review.needsGrading) : "",
    ];
  });
  return [header, ...rows].map((row) => row.map(csvField).join(",")).join("\n");
}

/**
 * A reteach group made from one wrong answer.
 *
 * The instructional groups this app already builds are statistical: every
 * student sorted by the standard they are weakest in. Useful, and a different
 * thing from what a teacher sees while grading. Nine children who all wrote
 * "9.2" did not make nine mistakes -- they made one, and it has a name. That
 * group is worth ten minutes on Monday in a way that "nine students are weak at
 * 7.RP.3" is not, because the second does not say what to actually teach.
 *
 * The grouping is free. It comes out of answers already read and already
 * grouped for batch grading; this only writes down what that grouping means.
 *
 * Named after the mistake rather than the standard, because that is the thing
 * the teacher is about to address and the thing they will recognise in the
 * list. The standard rides along so "plan a lesson" knows where to go.
 */
export function reteachGroup(
  classId: string,
  question: Question,
  group: Pick<AnswerGroup, "answer" | "studentIds">,
): Group {
  const wrote = group.answer.trim();
  return {
    id: crypto.randomUUID(),
    classId,
    name: wrote
      ? "Q" + question.number + ": wrote “" + wrote + "”"
      : "Q" + question.number + ": left blank",
    standard: question.standard || "",
    studentIds: [...new Set(group.studentIds)],
  };
}

/**
 * Adds a reteach group, replacing an earlier one for the same mistake rather
 * than stacking duplicates each time a teacher presses the button. Groups for
 * other classes and other questions are left alone -- unlike the suggested
 * groups, which are regenerated wholesale, this is one deliberate addition.
 */
export function withReteachGroup(groups: Group[], group: Group): Group[] {
  return [...groups.filter((g) => !(g.classId === group.classId && g.name === group.name)), group];
}

/** One point on a student's overall progress line: everything recorded on a
 * given day, averaged. */
export type ProgressPoint = {
  date: string;
  score: number;
  records: number;
  standards: string[];
};

/**
 * A student's progress across every standard, not one at a time.
 *
 * The per-standard history answers "is this child getting better at 7.RP.3",
 * which is the right question once you know which standard to ask about. The
 * question a teacher actually opens a student page with -- is this child doing
 * better than they were -- had no answer anywhere, because the evidence was
 * only ever sliced one standard at a time.
 *
 * Same day, same point: several records on one afternoon are one lesson's worth
 * of evidence, not several days of progress, and plotting them as separate
 * points draws a line that slopes on nothing.
 *
 * Costs nothing. Every record here was written when a teacher confirmed
 * grading they had already paid for.
 */
export function progressOverTime(student: Student): ProgressPoint[] {
  const byDate = new Map<string, { total: number; records: number; standards: Set<string> }>();
  for (const e of student.evidence) {
    if (!e.date) continue;
    const day = byDate.get(e.date) || { total: 0, records: 0, standards: new Set<string>() };
    day.total += e.score;
    day.records += 1;
    if (e.standard) day.standards.add(e.standard);
    byDate.set(e.date, day);
  }
  return [...byDate.entries()]
    .map(([date, day]) => ({
      date,
      score: Math.round(day.total / day.records),
      records: day.records,
      standards: [...day.standards].sort(),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The standard worth showing first on a student's page.
 *
 * It used to be whichever standard the catalog happened to list first, so a
 * student with a term's worth of evidence on one standard could open onto a
 * different one and show "Start their learning story" -- an empty state for a
 * child who is not short of evidence at all. Their most recent record is both
 * more useful and more honest.
 */
export function defaultFocusFor(student: Student | undefined, fallback: string) {
  if (!student) return fallback;
  const latest = [...student.evidence]
    .filter((e) => e.standard)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return latest?.standard || fallback;
}
