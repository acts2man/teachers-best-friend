import type { Assessment, Student, StudentResponse } from "./teacher-types";
import {
  mergeStudentResponses,
  normalizeRecognizedResponses,
} from "./teacher-workflow";
import { classroomColors } from "./teacher-data";

/** One question's graded response as read off a scanned page, before it is
 * attached to a resolved student. Mirrors the "responses" AI mode's shape. */
export type ScannedResponse = {
  questionId: string;
  answer: string;
  correct: boolean;
  match: number;
  misconception: string;
  confidence: number;
};

/** A name read off one page's cropped top band. */
export type PageName = { page: number; name: string; confidence: number };

/** Grading for one group, keyed by the group number the app supplied. */
export type GradedGroup = { group: number; responses: ScannedResponse[] };

/** One group of pages belonging to the same student. */
export type ScannedGroup = {
  pageIndexes: number[];
  detectedName: string;
  confidence: number;
  responses: ScannedResponse[];
};

/**
 * Splits a scanned stack into one group per student, using only the names read
 * off the cropped top bands.
 *
 * A page with a name starts a student. Pages after it with no name are that
 * student's continuation sheets -- which is what a blank name line means on a
 * multi-page worksheet. Pages before any name at all (a stray back side on top
 * of the pile) become their own group rather than being dropped, so nothing a
 * teacher scanned disappears silently.
 *
 * This is what lets grading happen without a name: the grouping is settled
 * here, from the strips, and the graded request is told the groups.
 */
export function groupPagesByName(pages: PageName[]): number[][] {
  const groups: number[][] = [];
  for (const page of pages) {
    if (page.name.trim() || !groups.length) groups.push([page.page]);
    else groups[groups.length - 1].push(page.page);
  }
  return groups;
}

/**
 * Splits a stack into one group per student using boundaries the teacher
 * declared while scanning -- "next student" -- rather than names the AI read.
 * `sizes[i]` is how many pages the teacher put in student i's pile, in scan
 * order, so the pages are numbered straight through the flattened stack.
 *
 * Preferred over groupPagesByName wherever the teacher scanned student by
 * student. A boundary the teacher drew is a fact; a boundary inferred from
 * whether a name was legible on a page is a guess, and when that guess is
 * wrong a page is graded against the wrong student's key. Empty piles are
 * skipped so a stray "next student" tap costs nothing.
 */
export function groupPagesByCapture(sizes: number[]): number[][] {
  const groups: number[][] = [];
  let page = 0;
  for (const size of sizes) {
    if (!Number.isInteger(size) || size <= 0) continue;
    groups.push(Array.from({ length: size }, () => page++));
  }
  return groups;
}

/** A scanned group after resolving it against the current roster, ready for
 * the teacher to confirm or correct before anything is saved. */
export type ResolvedGroup = ScannedGroup & {
  key: string;
  studentId: string | null;
  name: string;
  pageUploadIds: string[];
};

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Loose name match against the roster: an exact normalized match, or the
 * same first name with the same last-name initial (handles "Maria G." vs
 * "Maria Gonzalez", nicknames aside). Returns undefined rather than guessing
 * when nothing lines up, so an unmatched page is never silently misfiled.
 */
export function matchRosterStudent(
  name: string,
  students: Student[],
): Student | undefined {
  const key = normalizeName(name);
  if (!key) return undefined;
  const exact = students.find((s) => normalizeName(s.name) === key);
  if (exact) return exact;
  const tokens = key.split(" ");
  const first = tokens[0];
  const lastInitial = tokens.at(-1)?.[0];
  if (!first || tokens.length < 2) return undefined;
  return students.find((s) => {
    const sTokens = normalizeName(s.name).split(" ");
    return sTokens[0] === first && sTokens.at(-1)?.[0] === lastInitial;
  });
}

/**
 * Turns the model's raw page groups into editable review rows: each group is
 * matched against the current roster here, on our side, so the teacher only
 * has to confirm or fix names, never re-enter them from scratch.
 * `pageUploadIds[i]` is the uploaded file id for page `i`, in the order the
 * pages were scanned.
 *
 * Joins the two halves of a split scan: `pageGroups` and `names` come from
 * reading the cropped top bands, `graded` comes from grading the pages with
 * those bands removed. Neither request saw both, and the roster is sent to
 * neither -- matching a transcribed name to a student happens only here. See
 * docs/student-data-flow.md section 4.
 *
 * A group with no grading still comes back, empty, so a student whose pages
 * the model skipped appears in the review list for the teacher to notice
 * rather than vanishing from the stack.
 */
export function resolveScannedGroups(
  pageGroups: number[][],
  names: PageName[],
  graded: GradedGroup[],
  pageUploadIds: string[],
  students: Student[],
): ResolvedGroup[] {
  const nameOf = new Map(names.map((n) => [n.page, n]));
  const gradedByGroup = new Map(graded.map((g) => [g.group, g.responses]));
  return pageGroups.map((pages, i) => {
    const validPages = [
      ...new Set(
        pages.filter(
          (p) => Number.isInteger(p) && p >= 0 && p < pageUploadIds.length,
        ),
      ),
    ].sort((a, b) => a - b);
    // The name is whichever of this group's pages carried one -- in practice
    // the first, since that is what opened the group.
    const read = validPages.map((p) => nameOf.get(p)).find((n) => n?.name.trim());
    const detectedName = read?.name.trim() ?? "";
    const guessed = matchRosterStudent(detectedName, students);
    return {
      pageIndexes: validPages,
      detectedName,
      confidence: read?.confidence ?? 0,
      responses: gradedByGroup.get(i) ?? [],
      pageUploadIds: validPages.map((p) => pageUploadIds[p]),
      key: "group-" + i,
      studentId: guessed?.id ?? null,
      name: guessed?.name || detectedName || "Student " + (i + 1),
    };
  });
}

export type ConfirmedGroup = {
  studentId: string | null;
  name: string;
  pageUploadIds: string[];
  responses: ScannedResponse[];
};

/**
 * Applies teacher-confirmed groups to the workspace: creates a Student
 * record for any group with no matched student, merges each group's graded
 * responses into the assessment (replacing that student's prior responses
 * for this assessment, matching the single-student upload flow), and links
 * the scanned pages. Pure — the caller is responsible for persisting the
 * returned workspace slice.
 */
export function applyScannedGroups(
  a: Assessment,
  students: Student[],
  classId: string,
  groups: ConfirmedGroup[],
) {
  const newStudents: Student[] = [];
  const responsesByStudent = new Map<string, StudentResponse[]>();
  const studentUploadIds: Record<string, string[]> = {};
  let colorOffset = students.length;
  for (const group of groups) {
    if (!group.pageUploadIds.length || !group.responses.length) continue;
    let studentId = group.studentId;
    if (!studentId) {
      const created: Student = {
        id: crypto.randomUUID(),
        classId,
        name: group.name.trim() || "Unnamed student",
        color: classroomColors[colorOffset % classroomColors.length],
        evidence: [],
        notes: "",
      };
      colorOffset++;
      newStudents.push(created);
      studentId = created.id;
    }
    // Same rule as the single-student path: a later batch is another page of
    // the same test unless it actually answers the question, so keep what an
    // earlier pass found where this one saw nothing.
    responsesByStudent.set(
      studentId,
      mergeStudentResponses(
        a.responses.filter((r) => r.studentId === studentId),
        normalizeRecognizedResponses(a, studentId, group.responses),
      ),
    );
    studentUploadIds[studentId] = [
      ...new Set([
        ...(a.studentUploadIds?.[studentId] || []),
        ...group.pageUploadIds,
      ]),
    ];
  }
  const touchedIds = new Set(responsesByStudent.keys());
  const responses = [
    ...a.responses.filter((r) => !touchedIds.has(r.studentId)),
    ...[...responsesByStudent.values()].flat(),
  ];
  const pageIds = groups.flatMap((g) => g.pageUploadIds);
  const assessment: Assessment = {
    ...a,
    uploadIds: [...new Set([...a.uploadIds, ...pageIds])],
    studentUploadIds: { ...a.studentUploadIds, ...studentUploadIds },
    responses,
  };
  return {
    students: [...students, ...newStudents],
    assessment,
    newStudents,
    studentCount: touchedIds.size,
  };
}

/**
 * How much room one student's grading needs, and how many students therefore
 * fit in a single request.
 *
 * Measured, not guessed: across the real scans this app has run, grading one
 * student averaged 1,173 output tokens and peaked at 4,933, for ten-question
 * tests -- roughly 120 tokens per answer typically and near 500 when the model
 * writes a long misconception for every question. A whole-class request was
 * capped at 12,000 output tokens, so a stack of twelve students -- one class
 * set, front and back, inside the 24-page limit the UI already allowed --
 * asked for more than the ceiling and came back `incomplete`. The teacher lost
 * the scan and was told only to "try fewer pages".
 *
 * So the app decides how many students fit instead of finding out afterwards.
 * The estimate is deliberately pessimistic, because the cost of overestimating
 * is one extra request and the cost of underestimating is a failed class set.
 */
export const TOKENS_PER_ANSWER = 250;

/** Planning budget, kept well under the stage's real ceiling so a verbose
 * batch has somewhere to go. */
export const BATCH_OUTPUT_BUDGET = 16000;

export function studentsPerBatch(
  questionCount: number,
  budget = BATCH_OUTPUT_BUDGET,
) {
  const perStudent = Math.max(1, questionCount) * TOKENS_PER_ANSWER;
  // At least one student per request even for an enormous test: a single
  // student who does not fit is a different problem, and splitting a student
  // across requests would put half their answers in each.
  return Math.max(1, Math.floor(budget / perStudent) || 1);
}

/** One request's worth of a class scan. `groups` are re-numbered from zero
 * against `uploadIds`, because the model is told about this batch alone and
 * answers in its own numbering. `groupIndexes` maps each back to the group it
 * is in the whole scan. */
export type ScanBatch = {
  uploadIds: string[];
  groups: number[][];
  groupIndexes: number[];
};

/**
 * Splits a class scan into requests that will fit, keeping every student's
 * pages together in one request. A student is never split across two: their
 * answers have to be graded against the whole of their work at once, which is
 * the entire point of grouping pages by student in the first place.
 */
export function planScanBatches(
  pageGroups: number[][],
  pageUploadIds: string[],
  questionCount: number,
  budget = BATCH_OUTPUT_BUDGET,
): ScanBatch[] {
  const perBatch = studentsPerBatch(questionCount, budget);
  const batches: ScanBatch[] = [];
  for (let start = 0; start < pageGroups.length; start += perBatch) {
    const slice = pageGroups.slice(start, start + perBatch);
    const uploadIds: string[] = [];
    const groups = slice.map((pages) =>
      pages
        .filter((p) => p >= 0 && p < pageUploadIds.length)
        .map((page) => {
          uploadIds.push(pageUploadIds[page]);
          return uploadIds.length - 1;
        }),
    );
    if (!uploadIds.length) continue;
    batches.push({
      uploadIds,
      groups,
      groupIndexes: slice.map((_, i) => start + i),
    });
  }
  return batches;
}
