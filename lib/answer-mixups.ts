/**
 * Answers credited to the wrong paper (Michael, 2 Nov 2026, "Story
 * Organizer"). One class-set grading request returned the answers written on
 * page 6 for the student of page 5 and the other way round, and one answer on
 * both. The app could not see it: the request was told which pages were whose
 * and answered by group number.
 *
 * Two things here. The grading request now also says the name it reads on each
 * group's pages (`nameSeen`, lib/analyze-shared.ts), kept only as which roster
 * students it could be (seenFitsFor); when that fits neither the student the
 * teacher confirmed for the pile nor the name the name pass read on it, that
 * student's answers are marked `checkPages` -- Grade by question shows
 * "Answers may belong to another page — check". Nothing is moved for the
 * teacher: they look and decide. And the teacher can fix one:
 * move a student's answers to another student on the same test (a swap when
 * that student has answers too), or correct what an answer was read as.
 */
import { usableNameSeen } from "./name-seen";
import { rosterFit } from "./teacher-class-scan";
import type { Assessment, StudentResponse } from "./teacher-types";
import { answerKey } from "./teacher-workflow";
import { responseMatch } from "./teacher-metrics";

/** A read name this close to a name is the same person (lib/teacher-class-scan
 * FUZZY_FLOOR): nicknames, a first name alone and small misspellings pass. */
const SAME_PERSON = 0.8;

/**
 * Which roster students the name the grading pass read on a pile could be --
 * the only form in which that name is kept (review of #203). Turned into this
 * the moment a grading result reaches the phone, so the name itself is never
 * saved with the scan's progress (class_scan_sessions) or the workspace.
 * Undefined when no name was read, or the read is not a name ("?",
 * "unreadable", "Name:"); [] when it is a name that fits nobody here.
 */
export function seenFitsFor(nameSeen: unknown, students: { id: string; name: string }[]): string[] | undefined {
  const seen = usableNameSeen(nameSeen);
  if (!seen) return undefined;
  return students.filter((s) => rosterFit(seen, s.name) >= SAME_PERSON).map((s) => s.id);
}

/** A grading result with each group's read name replaced by seenFitsFor. */
export function withSeenFits<T extends { groups?: unknown }>(result: T, students: { id: string; name: string }[]): T {
  if (!result || !Array.isArray(result.groups)) return result;
  return {
    ...result,
    groups: result.groups.map((g) => {
      if (!g || typeof g !== "object") return g;
      const { nameSeen, ...rest } = g as Record<string, unknown>;
      const fits = seenFitsFor(nameSeen, students);
      return fits ? { ...rest, seenFits: fits } : rest;
    }),
  };
}

/**
 * Whether the grading pass read another paper for this pile. Only when the
 * name it read fits someone on the roster, the confirmed student is not one
 * of them, and the name the name pass read on the same pages does not fit
 * them either -- the two passes then saw different papers. A name read that
 * fits nobody (a new student, a misreading) is no evidence either way.
 */
export function pagesMayBelongElsewhere(
  seenFits: string[] | undefined,
  studentId: string,
  detectedName: string,
  students: { id: string; name: string }[],
): boolean {
  if (!seenFits?.length || seenFits.includes(studentId)) return false;
  const read = detectedName.trim();
  const sameAsRead = !!read && students.some((s) => seenFits.includes(s.id) && rosterFit(read, s.name) >= SAME_PERSON);
  return !sameAsRead;
}

/** Students on this test whose answers are marked to check, in response order. */
export function studentsToCheck(a: Pick<Assessment, "responses">): string[] {
  return [...new Set(a.responses.filter((r) => r.checkPages).map((r) => r.studentId))];
}

const unflag = (r: StudentResponse): StudentResponse => {
  if (!r.checkPages) return r;
  const { checkPages: _gone, ...rest } = r;
  void _gone;
  return rest;
};

/** The teacher looked and the answers are this student's: the mark goes. */
export function clearCheckPages(a: Assessment, studentId: string): Assessment {
  return { ...a, responses: a.responses.map((r) => (r.studentId === studentId ? unflag(r) : r)) };
}

/** A fresh id for an answer that changes hands (see moveAnswers). */
const newId = () => crypto.randomUUID();

/**
 * Moves `fromId`'s answers on this test to `toId`. If `toId` has answers, the
 * two swap: each keeps the other's. The scanned pages go with the answers
 * (their photos are of that paper), and so does the place in the pile, and
 * each answer keeps its crop (answerRegion). The check mark clears on both --
 * the teacher has decided.
 *
 * Every moved answer gets a NEW id (review of #203, reproduced on
 * production). The database keys an answer by (question, student) and also
 * keeps its id unique per teacher (responses_legacy_key): an answer that kept
 * its id while changing student landed on the other student's row, gave that
 * row an id the first row still held, and the whole save was refused --
 * "duplicate key value violates unique constraint". The old rows go, because
 * their ids are no longer in the workspace.
 */
export function moveAnswers(a: Assessment, fromId: string, toId: string): Assessment {
  if (!fromId || !toId || fromId === toId) return a;
  const swap = (id: string) => (id === fromId ? toId : id === toId ? fromId : id);
  const pages = { ...(a.studentUploadIds || {}) };
  const fromPages = pages[fromId];
  const toPages = pages[toId];
  delete pages[fromId];
  delete pages[toId];
  if (fromPages) pages[toId] = fromPages;
  if (toPages) pages[fromId] = toPages;
  const order = a.studentOrder ? a.studentOrder.map(swap) : undefined;
  return {
    ...a,
    responses: a.responses.map((r) =>
      r.studentId === fromId || r.studentId === toId ? unflag({ ...r, id: newId(), studentId: swap(r.studentId) }) : r,
    ),
    ...(a.studentUploadIds ? { studentUploadIds: pages } : {}),
    ...(order ? { studentOrder: [...new Set(order)] } : {}),
  };
}

/**
 * Undo of a move or swap: the two students' answers, pages, place in the
 * pile and check marks as they were in `before`, under fresh ids again (the
 * ids in `before` were just removed by the move, and reusing them would hit
 * the same unique key on the way back). Everyone else stays as `current` has
 * them.
 */
export function undoMove(current: Assessment, before: Assessment, ids: string[]): Assessment {
  const who = new Set(ids);
  const pages = { ...(current.studentUploadIds || {}) };
  for (const id of ids) {
    delete pages[id];
    const was = before.studentUploadIds?.[id];
    if (was) pages[id] = was;
  }
  return {
    ...current,
    responses: [
      ...current.responses.filter((r) => !who.has(r.studentId)),
      ...before.responses.filter((r) => who.has(r.studentId)).map((r) => ({ ...r, id: newId() })),
    ],
    ...(current.studentUploadIds || before.studentUploadIds ? { studentUploadIds: pages } : {}),
    ...(before.studentOrder ? { studentOrder: before.studentOrder } : {}),
  };
}

/** How many answers each side of a move has: for the confirm. */
export function moveCounts(a: Pick<Assessment, "responses">, fromId: string, toId: string) {
  return {
    from: a.responses.filter((r) => r.studentId === fromId).length,
    to: a.responses.filter((r) => r.studentId === toId).length,
  };
}

/** Whether moving onto `toId` is a swap (they have answers on this test). */
export function moveIsSwap(a: Pick<Assessment, "responses">, toId: string): boolean {
  return a.responses.some((r) => r.studentId === toId);
}

/**
 * The teacher corrects what an answer was read as ("Written as"). The text is
 * what the student wrote, so it is also the final answer Grade by question
 * groups on. It must never leave the answer in a group showing one credit
 * while it carries another (review of #203):
 *   - other answers to this question read the same way, all with one credit:
 *     it takes that credit -- the teacher already decided that answer;
 *   - none, or several credits among them: it stands on its own (graded
 *     alone), undecided, for the teacher to grade.
 * An empty reading is refused (null): blank is a reading the AI makes, and a
 * teacher clearing the box by accident would silently grade it as blank.
 */
export function editWrittenAnswer(a: Assessment, responseId: string, text: string): Assessment | null {
  const value = text.trim().slice(0, 500);
  const r = a.responses.find((x) => x.id === responseId);
  if (!value || !r) return null;
  const key = answerKey(value) || "written:" + value.toLowerCase();
  const peers = a.responses.filter(
    (x) =>
      x.id !== r.id &&
      x.questionId === r.questionId &&
      !x.gradedAlone &&
      (answerKey(x.finalAnswer?.trim() || x.answer) || "written:" + (x.answer.trim() || x.finalAnswer?.trim() || "").toLowerCase()) === key,
  );
  const credit = (x: StudentResponse) => [x.verified, x.correct, Math.round(responseMatch(x)), x.errorType || ""].join("|");
  const one = peers.length > 0 && peers.every((p) => credit(p) === credit(peers[0]));
  const { gradedAlone: _alone, ...base } = r;
  void _alone;
  const next: StudentResponse = one
    ? {
        ...base,
        answer: value,
        finalAnswer: value,
        verified: peers[0].verified,
        correct: peers[0].correct,
        match: peers[0].match,
        errorType: peers[0].errorType,
        confidence: Math.max(r.confidence, peers[0].confidence),
      }
    : { ...base, answer: value, finalAnswer: value, verified: false, gradedAlone: true };
  return { ...a, responses: a.responses.map((x) => (x.id === r.id ? next : x)) };
}
