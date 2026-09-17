import type { Assessment, Student, StudentResponse } from "./teacher-types";
import { normalizeRecognizedResponses } from "./teacher-workflow";
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
    responsesByStudent.set(
      studentId,
      normalizeRecognizedResponses(a, studentId, group.responses),
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
