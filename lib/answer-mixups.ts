/**
 * Answers credited to the wrong paper (Michael, 2 Nov 2026, "Story
 * Organizer"). One class-set grading request returned the answers written on
 * page 6 for the student of page 5 and the other way round, and one answer on
 * both. The app could not see it: the request was told which pages were whose
 * and answered by group number.
 *
 * Two things here. The grading request now also says the name it reads on each
 * group's pages (`nameSeen`, lib/analyze-shared.ts), and when that name fits
 * neither the student the teacher confirmed for the pile nor the name the name
 * pass read on it, that student's answers are marked `checkPages` -- Grade by
 * question shows "Answers may belong to another page — check". Nothing is
 * moved for the teacher: they look and decide. And the teacher can fix one:
 * move a student's answers to another student on the same test (a swap when
 * that student has answers too), or correct what an answer was read as.
 */
import { rosterFit } from "./teacher-class-scan";
import type { Assessment, StudentResponse } from "./teacher-types";

/** A read name this close to a name is the same person (lib/teacher-class-scan
 * FUZZY_FLOOR): nicknames, a first name alone and small misspellings pass. */
const SAME_PERSON = 0.8;

/**
 * Whether the name the grading pass read on a pile's pages says the answers
 * may belong to another paper. Only when it read a name at all, and that name
 * fits neither the student the pile was confirmed as nor what the name pass
 * read on the same pages -- the two passes then saw different papers.
 */
export function pagesMayBelongElsewhere(nameSeen: string | undefined, studentName: string, detectedName = ""): boolean {
  const seen = (nameSeen ?? "").trim();
  if (!seen) return false;
  const fits = (name: string) => !!name.trim() && rosterFit(seen, name) >= SAME_PERSON;
  return !fits(studentName) && !fits(detectedName);
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

/**
 * Moves `fromId`'s answers on this test to `toId`. If `toId` has answers, the
 * two swap: each keeps the other's. The scanned pages go with the answers
 * (their photos are of that paper), and so does the place in the pile. The
 * check mark clears on both -- the teacher has decided.
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
      r.studentId === fromId || r.studentId === toId ? unflag({ ...r, studentId: swap(r.studentId) }) : r,
    ),
    ...(a.studentUploadIds ? { studentUploadIds: pages } : {}),
    ...(order ? { studentOrder: [...new Set(order)] } : {}),
  };
}

/** Whether moving onto `toId` is a swap (they have answers on this test). */
export function moveIsSwap(a: Pick<Assessment, "responses">, toId: string): boolean {
  return a.responses.some((r) => r.studentId === toId);
}

/**
 * The teacher corrects what an answer was read as ("Written as"). The text is
 * what the student wrote, so it is also the final answer Grade by question
 * groups on: the answer moves to the group of students who wrote the same.
 * Its credit is left as it was -- the teacher regrades it if the reading
 * changed it.
 */
export function editWrittenAnswer(a: Assessment, responseId: string, text: string): Assessment {
  const value = text.trim().slice(0, 500);
  return {
    ...a,
    responses: a.responses.map((r) => (r.id === responseId ? { ...r, answer: value, finalAnswer: value } : r)),
  };
}
