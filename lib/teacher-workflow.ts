import type {
  Assessment,
  Group,
  Question,
  RubricDimension,
  Student,
  StudentResponse,
} from "./teacher-types";
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
 * The standards "speed lane" (Ricky): a question at 80%+ alignment is strong
 * and shows green; under 80% shows red with its percentage and a small
 * "Strengthen?" link -- but the teacher does not have to open each one. A
 * standard the teacher assigned themselves ("—", no AI score) counts as strong:
 * the teacher chose it.
 */
export const STRONG_ALIGNMENT = 80;
export function alignmentIsStrong(q: Question): boolean {
  return !(q.alignment > 0) || q.alignment >= STRONG_ALIGNMENT;
}

/**
 * "Looks good": confirms every question that has a standard in one action,
 * which is what the readiness check asks for. A question with no standard
 * cannot be confirmed -- readiness needs one -- and is left for the teacher.
 */
export function confirmAllQuestions(a: Assessment): { assessment: Assessment; confirmed: number; missingStandard: number } {
  let confirmed = 0;
  let missingStandard = 0;
  const questions = a.questions.map((q) => {
    if (q.excluded || q.verified) return q;
    if (!q.standard) {
      missingStandard++;
      return q;
    }
    confirmed++;
    return { ...q, verified: true };
  });
  const allReviewed = questions.every((q) => q.excluded || (q.verified && q.standard));
  return {
    assessment: { ...a, questions, status: allReviewed ? "Ready" : a.status },
    confirmed,
    missingStandard,
  };
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
  const missing = questions.filter(
    (q) => !responses.some((r) => r.questionId === q.id),
  );
  const complete =
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
    missing,
    complete,
    // Answers that exist but the teacher has not decided yet -- the "other"
    // verdicts and anything else still pending. These are not counted as zero in
    // the score (the score averages verified answers only); they are surfaced so
    // a partial score is never mistaken for a final one.
    needsGrading: pending.length,
    score: reviewed.length
      ? Math.round(
          reviewed.reduce((sum, response) => sum + responseMatch(response), 0) /
            reviewed.length,
        )
      : null,
  };
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
  verdict: "match" | "blank" | "other";
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
    const isMatch = response?.verdict === "match";
    // Blank when the AI said "blank", and also when nothing usable came back at
    // all -- a missing or duplicated question is not the teacher's to decide.
    const isBlank = !response || response.verdict === "blank";
    return {
      id: crypto.randomUUID(),
      studentId,
      questionId: q.id,
      answer: isBlank ? "" : response.answer || "",
      correct: isMatch,
      // match 100 for a clean match, 0 for a blank, and UNSET for "other" so no
      // AI-guessed partial is stored -- responseMatch reads unset as 0 for the
      // running total while groupAnswers still surfaces it for a decision.
      match: isMatch ? 100 : isBlank ? 0 : undefined,
      misconception:
        matches.length > 1
          ? "More than one answer was recognized. Check the original work."
          : matches.length === 0
            ? "No readable answer was recognized. Check the original work."
            : "",
      // Reading confidence is now binary: the AI either read an answer for this
      // question (100) or it did not (0). It no longer estimates a percentage.
      confidence: response ? 100 : 0,
      verified: false,
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
      : scoreLabel(summary.score, a.pointsPossible)) +
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
    const target = studentReview(a, studentId).complete ? done : held;
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
export type AnswerGroup = {
  key: string;
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
};

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
  for (const r of inOrder) {
    const key = answerKey(r.answer);
    const existing = groups.get(key);
    if (existing) {
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
      answer: r.answer,
      responseIds: [r.id],
      studentIds: [r.studentId],
      correct: r.correct,
      verified: r.verified,
      match: responseMatch(r),
      needsDecision: false,
      errorType: r.errorType || "",
    });
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
      needsDecision:
        !!question &&
        !question.excluded &&
        !!g.answer.trim() &&
        !g.verified &&
        !(g.correct && g.match >= 100),
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
      const blank = !r.answer.trim();
      const cleanMatch = r.correct && responseMatch(r) >= 100;
      return blank || cleanMatch;
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
  const header = [
    "Student",
    ...questions.map((q) => "Q" + q.number),
    "Score %",
    "Reviewed",
    "Needs grading",
  ];
  const rows = students.map((student) => {
    const review = studentReview(a, student.id);
    const byQuestion = new Map(review.responses.map((r) => [r.questionId, r]));
    // Until every answer is graded, the Score % is not a final score, so it is
    // marked "Incomplete" rather than printing a partial as if it were the
    // result. The per-question columns still show what has been graded, and the
    // count of answers still waiting is its own column.
    const scoreCell =
      review.score === null
        ? ""
        : review.complete
          ? String(review.score)
          : "Incomplete";
    return [
      student.name,
      ...questions.map((q) => {
        const r = byQuestion.get(q.id);
        if (!r || !r.verified) return "";
        return String(responseMatch(r));
      }),
      scoreCell,
      review.reviewed.length + "/" + questions.length,
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
