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
