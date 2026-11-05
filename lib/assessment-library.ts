/**
 * The Assessment Library (Ricky, 23 and 27 Oct 2026): "When a Test is uploaded
 * and an Answer Key is confirmed, it should automatically be saved in the
 * Assessment Library. That assessment needs to be available for all classes.
 * If they switch classes and pull from the assessment library, it should skip
 * to upload student work." Grouped by course, alphabetical.
 *
 * Nothing new is stored. A test is in the library because of what it already
 * is (a confirmed answer key), its course is read from the test itself (grade
 * and subject), and using it in a class is the same `classIds` link the share
 * dialog has always written -- persisted by sync_workspace / get_workspace_json
 * since the relational schema. Questions and the key are shared; each class's
 * student work stays with that class's students (lib/teacher-classes.ts).
 */
import { classGradingMode, gradingModeOf } from "./grading-mode";
import { assessmentInClass, shareAssessmentWith } from "./teacher-classes";
import { activeQuestions, preparationGaps } from "./teacher-workflow";
import type { Assessment, Classroom, Workspace } from "./teacher-types";

/**
 * In the library: a test whose answer key the teacher has confirmed. The same
 * rule the setup checklist uses (preparationGaps): `answerKeyVerified`, or a
 * sample test from before the flag existed. A writing test has a rubric, not
 * an answer key, so it is not in the library.
 */
export function inLibrary(a: Pick<Assessment, "rubric" | "answerKeyVerified" | "source">): boolean {
  if (a.rubric) return false;
  return a.answerKeyVerified === true || (a.answerKeyVerified === undefined && a.source === "sample");
}

const SUBJECT_NAMES: Record<Assessment["subject"], string> = { Math: "Math", ELA: "ELA", Mixed: "Mixed subjects" };

/** A test's course, as the library groups it: "Grade 7 Math". */
export function courseOf(a: Pick<Assessment, "grade" | "subject">): string {
  return (a.grade === 0 ? "Kindergarten" : "Grade " + a.grade) + " " + SUBJECT_NAMES[a.subject];
}

const byName = (x: string, y: string) => x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });

/** Every library test, by course. Courses in order (Grade 4 before Grade 10),
 * tests alphabetical within each. */
export function libraryCourses(w: Pick<Workspace, "assessments">): { course: string; tests: Assessment[] }[] {
  const groups = new Map<string, Assessment[]>();
  for (const a of w.assessments.filter(inLibrary)) {
    const c = courseOf(a);
    groups.set(c, [...(groups.get(c) || []), a]);
  }
  return [...groups.entries()]
    .sort(([x], [y]) => byName(x, y))
    .map(([course, tests]) => ({ course, tests: [...tests].sort((x, y) => byName(x.title, y.title) || byName(x.id, y.id)) }));
}

/** The classes a library test can be used in: every class graded the same way
 * as the test (one test has one mode), and any class it is already in. */
export function libraryClassesFor(w: Pick<Workspace, "classes" | "assessments">, a: Assessment): Classroom[] {
  return w.classes.filter((c) => assessmentInClass(a, c.id) || classGradingMode(w, c) === gradingModeOf(a));
}

/**
 * Picks a library test for a class: links it to the class (if it is not there
 * yet) and makes that class the one on screen, so the test opens on its
 * Student work step for that class's students. Null when the class cannot use
 * it -- graded the other way -- or the test is not in the library.
 */
export function pickFromLibrary(w: Workspace, assessmentId: string, classId: string): Workspace | null {
  const a = w.assessments.find((x) => x.id === assessmentId);
  const c = w.classes.find((x) => x.id === classId);
  if (!a || !c || !inLibrary(a)) return null;
  if (!libraryClassesFor(w, a).some((x) => x.id === c.id)) return null;
  return {
    ...w,
    assessments: w.assessments.map((x) => (x.id === a.id ? shareAssessmentWith(a, [c.id]) : x)),
    activeClassId: c.id,
  };
}

/** Where picking a library test lands: its Student work step, scrolled to the
 * class-set upload. */
export function libraryStudentWorkUrl(assessmentId: string): string {
  return "/assessments?id=" + encodeURIComponent(assessmentId) + "&tab=responses&from=library";
}

/**
 * Questions still to review before the test can be scanned. A confirmed key
 * is not quite "ready": scanning also waits on every question's standard (on
 * 3 Nov 2026, 2 of the 9 confirmed-key tests on record had questions left).
 * Zero means picking it goes straight to uploading student work.
 */
export function librarySetupLeft(a: Assessment): number {
  if (preparationGaps(a).ready) return 0;
  const open = activeQuestions(a).filter((q) => !q.verified || !q.standard || !q.answer.trim()).length;
  return Math.max(1, open);
}

/** Where picking lands: Student work when the test can be scanned, otherwise
 * the review step that still needs finishing -- never a scan that is off. */
export function libraryLandingUrl(a: Assessment): string {
  return librarySetupLeft(a) ? "/assessments?id=" + encodeURIComponent(a.id) + "&tab=questions" : libraryStudentWorkUrl(a.id);
}
