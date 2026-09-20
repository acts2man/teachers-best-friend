import type {
  Assessment,
  Group,
  Question,
  Student,
  StudentResponse,
} from "./teacher-types";
import { responseMatch } from "./teacher-metrics";

export function activeQuestions(a: Assessment) {
  return a.questions.filter((q) => !q.excluded);
}

export function preparationGaps(a: Assessment) {
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
        ? { ...r, verified: false, confidence: 0, match: 0 }
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

export function normalizeRecognizedResponses(
  a: Assessment,
  studentId: string,
  incoming: Omit<StudentResponse, "id" | "studentId" | "verified">[],
): StudentResponse[] {
  return activeQuestions(a).map((q) => {
    const matches = incoming.filter((r) => r.questionId === q.id);
    const response = matches.length === 1 ? matches[0] : undefined;
    return {
      id: crypto.randomUUID(),
      studentId,
      questionId: q.id,
      answer: response?.answer || "",
      correct: response?.correct || false,
      match: response ? responseMatch(response) : 0,
      misconception:
        response?.misconception ||
        (matches.length > 1
          ? "More than one answer was recognized. Check the original work."
          : "No readable answer was recognized. Check the original work."),
      confidence: response?.confidence || 0,
      verified: false,
    };
  });
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
    (summary.score === null ? "Not yet available" : summary.score + "%") +
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
  needsDecision: boolean;
};

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
  for (const r of a.responses) {
    if (r.questionId !== questionId) continue;
    const key = answerKey(r.answer);
    const existing = groups.get(key);
    if (existing) {
      existing.responseIds.push(r.id);
      existing.studentIds.push(r.studentId);
      existing.correct = existing.correct && r.correct;
      existing.match = Math.min(existing.match, responseMatch(r));
      continue;
    }
    groups.set(key, {
      key,
      answer: r.answer,
      responseIds: [r.id],
      studentIds: [r.studentId],
      correct: r.correct,
      match: responseMatch(r),
      needsDecision: false,
    });
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      // A blank is a zero and a clean match is full credit; neither needs the
      // teacher. Everything in between is the partial credit they asked to be
      // able to settle a batch at a time.
      needsDecision:
        !!question &&
        !question.excluded &&
        !!g.answer.trim() &&
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
export function applyGroupScore(
  a: Assessment,
  responseIds: string[],
  match: number,
): Assessment {
  const ids = new Set(responseIds);
  const score = Math.max(0, Math.min(100, Math.round(match)));
  return {
    ...a,
    responses: a.responses.map((r) =>
      ids.has(r.id)
        ? { ...r, match: score, correct: score >= 100, verified: true }
        : r,
    ),
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
    "Points",
    "Reviewed",
  ];
  const rows = students.map((student) => {
    const review = studentReview(a, student.id);
    const byQuestion = new Map(review.responses.map((r) => [r.questionId, r]));
    return [
      student.name,
      ...questions.map((q) => {
        const r = byQuestion.get(q.id);
        if (!r || !r.verified) return "";
        return String(responseMatch(r));
      }),
      review.score === null ? "" : String(review.score),
      review.reviewed.length + "/" + questions.length,
      review.complete ? "Yes" : review.reviewed.length ? "Partly" : "No",
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
