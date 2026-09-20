import type { Assessment, Classroom, Workspace } from "./teacher-types";

// An assessment belongs to the class it was created in and can be shared with
// other classes. Questions and the answer key are shared; each class's student
// work stays with that class's students.
export function assessmentClassIds(a: Pick<Assessment, "classId" | "classIds">) {
  return [...new Set([a.classId, ...(a.classIds || [])])];
}

export function assessmentInClass(
  a: Pick<Assessment, "classId" | "classIds">,
  classId: string,
) {
  return assessmentClassIds(a).includes(classId);
}

export function classesFor(w: Pick<Workspace, "classes">, a: Assessment) {
  const ids = assessmentClassIds(a);
  return w.classes.filter((c) => ids.includes(c.id));
}

export function classSummary(
  w: Pick<Workspace, "students" | "assessments" | "lessons">,
  c: Classroom,
) {
  return {
    students: w.students.filter((s) => s.classId === c.id).length,
    assessments: w.assessments.filter((a) => assessmentInClass(a, c.id)).length,
    lessons: w.lessons.filter((l) => l.classId === c.id).length,
  };
}

// Turn a printed roster into short, privacy-friendly aliases when asked.
export function shortenName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "";
  // "Last, First" rosters are common; put the first name first.
  if (parts[0].endsWith(",")) {
    const first = parts.slice(1).join(" ");
    const last = parts[0].replace(/,$/, "");
    return first + " " + last.charAt(0).toUpperCase() + ".";
  }
  return parts[0] + " " + parts[parts.length - 1].charAt(0).toUpperCase() + ".";
}

// Fallback for typed PDF rosters when the AI reader is not connected: keep
// lines that look like names and drop headers, numbers, and emails.
export function namesFromText(text: string) {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of text.split(/\n|;|\t/)) {
    const line = raw.replace(/^\s*\d+[.)]?\s*/, "").trim();
    if (!line || line.length > 60) continue;
    if (/@|\d{3,}|^(name|student|students|roster|period|grade|teacher|class)s?\b/i.test(line))
      continue;
    if (!/^[A-Za-zÀ-ÿ'’.\-]+(,?\s+[A-Za-zÀ-ÿ'’.\-]+){1,3}$/.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(line);
  }
  return names.slice(0, 60);
}

/**
 * Takes one student off a roster: the record itself, their graded responses on
 * every assessment, the scanned pages linked to them, and their place in any
 * group.
 *
 * There was no way to do this at all until a pilot teacher asked. It matters
 * more since scanning a stack started creating students from names it could not
 * match to the roster -- a misread name makes a student who never existed, and
 * without this they were permanent. Pure; the caller persists the result.
 */
export function removeStudent(w: Workspace, studentId: string): Workspace {
  return {
    ...w,
    students: w.students.filter((s) => s.id !== studentId),
    assessments: w.assessments.map((a) => {
      if (!a.studentUploadIds?.[studentId] && !a.responses.some((r) => r.studentId === studentId))
        return a;
      return {
        ...a,
        responses: a.responses.filter((r) => r.studentId !== studentId),
        studentUploadIds: Object.fromEntries(
          Object.entries(a.studentUploadIds || {}).filter(
            ([id]) => id !== studentId,
          ),
        ),
      };
    }),
    groups: (w.groups || []).map((g) =>
      g.studentIds?.includes(studentId)
        ? { ...g, studentIds: g.studentIds.filter((id) => id !== studentId) }
        : g,
    ),
  };
}

/**
 * Everything a teacher needs gone when they clear a class back to empty: the
 * students, their graded answers, their evidence, and the scanned pages of
 * their work. The class itself and the teacher's own assessments, questions and
 * answer keys stay, so the next roster has something to be tested against.
 *
 * Returns the workspace alongside the upload ids the caller still has to delete
 * from storage -- unlinking a photograph is not the same as deleting it, and a
 * teacher clearing a roster means the second one.
 */
export function clearClassStudents(w: Workspace, classId: string) {
  const leaving = w.students.filter((s) => s.classId === classId);
  const ids = new Set(leaving.map((s) => s.id));
  const uploadIds = new Set<string>();
  const assessments = w.assessments.map((a) => {
    const byStudent = a.studentUploadIds || {};
    const keptStudentUploads: Record<string, string[]> = {};
    for (const [studentId, pages] of Object.entries(byStudent)) {
      if (ids.has(studentId)) for (const page of pages || []) uploadIds.add(page);
      else keptStudentUploads[studentId] = pages || [];
    }
    return {
      ...a,
      responses: a.responses.filter((r) => !ids.has(r.studentId)),
      studentUploadIds: keptStudentUploads,
      uploadIds: a.uploadIds.filter((id) => !uploadIds.has(id)),
    };
  });
  return {
    workspace: {
      ...w,
      students: w.students.filter((s) => !ids.has(s.id)),
      assessments,
      groups: (w.groups || []).map((g) =>
        g.studentIds?.some((id) => ids.has(id))
          ? { ...g, studentIds: g.studentIds.filter((id) => !ids.has(id)) }
          : g,
      ),
    },
    uploadIds: [...uploadIds],
    studentCount: leaving.length,
  };
}

/**
 * Whether an assessment's questions mean anything in a given class.
 *
 * The questions carry standards from one grade and framework's catalog. Shared
 * into a class on a different one, the alignment scores are measured against
 * standards those children are not being taught, and the class analysis has
 * nothing to match on -- it does not fail, it quietly reports very little.
 *
 * Deliberately only a fact, not a rule. A teacher giving a seventh-grade test
 * to a fourth-grade group for intervention is doing something sensible, and the
 * app has no business refusing it. The picker says which classes are a mismatch
 * and lets the teacher decide, because they know why and we do not.
 */
export function assessmentFitsClass(
  a: Pick<Assessment, "grade" | "framework">,
  c: Pick<Classroom, "grade" | "framework">,
) {
  return c.grade === a.grade && c.framework === a.framework;
}

/**
 * Uses an existing assessment in another class as well. The questions and
 * answer key are shared; each class keeps its own students' work, so nothing
 * one period did shows up in another period's results.
 */
export function shareAssessmentWith(a: Assessment, classIds: string[]): Assessment {
  const added = classIds.filter((id) => id && id !== a.classId);
  if (!added.length) return a;
  return {
    ...a,
    classIds: [...new Set([...assessmentClassIds(a), ...added])].filter(
      (id) => id !== a.classId,
    ),
  };
}
