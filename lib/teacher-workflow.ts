import type {
  Assessment,
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
    href: "/scan?mode=responses&assessment=" + a.id,
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
