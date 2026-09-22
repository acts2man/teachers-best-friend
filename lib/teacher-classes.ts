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

// Jr, Sr and the regnal numbers are not a family name, and taking their
// initial gives a class full of "John J." and "Marcus I."
//
// Deliberately no bare "V": a last initial genuinely is one letter, so "Maria
// V." -- a name this app writes itself -- would lose its surname entirely and
// come back as "Maria". The fifth of his name is rarer than that mistake.
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
const isSuffix = (token: string) =>
  NAME_SUFFIXES.has(token.toLowerCase().replace(/[.,]/g, ""));

/**
 * The given name and the family name, however the roster wrote them.
 *
 * Handles "Last, First" (one comma, the form school systems export) and
 * trailing suffixes. Exported because the importer needs the same reading the
 * shortener uses -- two different answers to "which word is the surname" is how
 * a review list and a saved record end up disagreeing.
 */
export function nameParts(name: string): { first: string; last: string } {
  const trimmed = name.trim();
  const comma = trimmed.indexOf(",");
  if (comma !== -1 && trimmed.indexOf(",", comma + 1) === -1) {
    const last = trimmed.slice(0, comma).trim();
    const first = trimmed.slice(comma + 1).trim();
    if (last && first) return { first, last: dropSuffix(last) };
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { first: parts[0] || "", last: "" };
  let end = parts.length - 1;
  while (end > 0 && isSuffix(parts[end])) end -= 1;
  // The first token only, which is what this has always done: middle names are
  // not part of a "first name and last initial" alias.
  return { first: parts[0], last: end > 0 ? parts[end] : "" };
}

function dropSuffix(value: string): string {
  const parts = value.split(/\s+/).filter(Boolean);
  let end = parts.length - 1;
  while (end > 0 && isSuffix(parts[end])) end -= 1;
  return parts.slice(0, end + 1).join(" ");
}

// Turn a printed roster into short, privacy-friendly aliases when asked.
export function shortenName(name: string) {
  const { first, last } = nameParts(name);
  if (!last) return first;
  return first + " " + last.charAt(0).toUpperCase() + ".";
}

/** A name to be saved, with the roster's own columns when we have them. */
export type NameToSave = { name: string; first?: string; last?: string };

/** Case, spacing and punctuation ignored. The identity two names share or do not. */
export function nameKey(name: string): string {
  return name.toLowerCase().replace(/[.\u2019']/g, "").replace(/\s+/g, " ").trim();
}

const capitalize = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);

/**
 * Short names for a whole class at once, so no two students get the same one.
 *
 * "First name and last initial" is a privacy default, not an identity. Maria
 * Garcia, Maria Gonzalez and Maria Guzman all shorten to "Maria G." -- and the
 * importer, which deduplicated on the shortened form, silently dropped two of
 * the three children. It also made them indistinguishable to the name-strip
 * step of a class scan, which is a graded page landing on the wrong student.
 *
 * So the last name is extended one letter at a time until the group is
 * distinct: Maria Ga., Maria Go., Maria Gu. The whole group moves together
 * rather than only the ones that clashed, because "Maria G." next to "Maria
 * Go." reads as a mistake.
 *
 * True namesakes -- same first name, same surname, two different children --
 * cannot be told apart by any amount of letters, so they are numbered rather
 * than merged. A number is ugly; losing a child off the roster is worse.
 *
 * `existing` is what the class already has. Those are never rewritten: a
 * student who has been "Maria G." all term stays "Maria G.", and the import
 * works around her.
 */
export function assignShortNames(
  incoming: NameToSave[],
  existing: string[] = [],
): string[] {
  const taken = new Set(existing.map(nameKey));
  const out: string[] = new Array(incoming.length).fill("");

  const parts = incoming.map((item) => {
    if (item.first || item.last)
      return { first: (item.first ?? "").trim(), last: (item.last ?? "").trim() };
    return nameParts(item.name);
  });

  // Group by given name: only students sharing one can collide.
  const groups = new Map<string, number[]>();
  parts.forEach((p, i) => {
    const key = nameKey(p.first);
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });

  const alias = (first: string, last: string, letters: number) => {
    if (!last) return first;
    if (letters >= last.length) return (first + " " + last).trim();
    return first + " " + capitalize(last.slice(0, letters)) + ".";
  };

  for (const members of groups.values()) {
    const longest = Math.max(...members.map((i) => parts[i].last.length), 1);
    // The shortest alias length at which this group is distinct from itself
    // AND from everyone already in the class.
    let letters = longest;
    for (let n = 1; n <= longest; n += 1) {
      const seen = new Set<string>();
      let clash = false;
      for (const i of members) {
        const key = nameKey(alias(parts[i].first, parts[i].last, n));
        if (seen.has(key) || taken.has(key)) {
          clash = true;
          break;
        }
        seen.add(key);
      }
      if (!clash) {
        letters = n;
        break;
      }
    }
    for (const i of members) {
      const base = alias(parts[i].first, parts[i].last, letters);
      let candidate = base;
      let suffix = 2;
      // Namesakes, or a clash with a student already enrolled.
      while (taken.has(nameKey(candidate))) {
        candidate = `${base} ${suffix}`;
        suffix += 1;
      }
      taken.add(nameKey(candidate));
      out[i] = candidate;
    }
  }
  return out;
}

/**
 * The save path's guard: names that are already final, made distinct.
 *
 * Deliberately does NOT shorten. By the time a name reaches the save it has
 * been through the review list and may already be "Maria Ga." -- re-running
 * the shortener on that would turn it back into "Maria G." and undo the very
 * thing this change is for. It only appends a number when the name is already
 * taken, which is what a second tab or a stale review list can produce.
 */
export function ensureDistinctNames(names: string[], existing: string[] = []): string[] {
  const taken = new Set(existing.map(nameKey));
  return names.map((name) => {
    let candidate = name.trim();
    let suffix = 2;
    while (candidate && taken.has(nameKey(candidate))) {
      candidate = `${name.trim()} ${suffix}`;
      suffix += 1;
    }
    taken.add(nameKey(candidate));
    return candidate;
  });
}

// Fallback for typed PDF rosters when the AI reader is not connected: keep
// lines that look like names and drop headers, numbers, and emails.
//
// Returns everything it found. It used to end `.slice(0, 60)`, so a roster of
// 64 children handed back 60 and said nothing -- four names simply were not
// there, and nobody could tell that from looking. Whatever comes back goes
// into the review list, where the teacher sees the count and is told plainly
// if it is more than one add can carry.
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
  return names;
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
