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

/** One group of pages the model believes belong to the same student. */
export type ScannedGroup = {
  pageIndexes: number[];
  detectedName: string;
  matchedRosterName: string;
  confidence: number;
  responses: ScannedResponse[];
};

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
 * matched against the current roster (first by the model's own guess, then
 * by loose name matching) so the teacher only has to confirm or fix names,
 * never re-enter them from scratch. `pageUploadIds[i]` is the uploaded file
 * id for `pages[i]`, in the same order sent to the model.
 */
export function resolveScannedGroups(
  groups: ScannedGroup[],
  pageUploadIds: string[],
  students: Student[],
): ResolvedGroup[] {
  return groups.map((group, i) => {
    const validPages = [
      ...new Set(
        group.pageIndexes.filter(
          (p) => Number.isInteger(p) && p >= 0 && p < pageUploadIds.length,
        ),
      ),
    ].sort((a, b) => a - b);
    const byRosterGuess = group.matchedRosterName
      ? students.find(
          (s) => normalizeName(s.name) === normalizeName(group.matchedRosterName),
        )
      : undefined;
    const guessed = byRosterGuess || matchRosterStudent(group.detectedName, students);
    return {
      ...group,
      pageIndexes: validPages,
      pageUploadIds: validPages.map((p) => pageUploadIds[p]),
      key: "group-" + i,
      studentId: guessed?.id ?? null,
      name:
        guessed?.name ||
        group.matchedRosterName.trim() ||
        group.detectedName.trim() ||
        "Student " + (i + 1),
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
