/**
 * "Overview = jump back into the last class and test the teacher was working
 * on" (Ricky, 23 Oct 2026).
 *
 * Remembered two ways, the newer winning:
 *   - in the workspace, `settings.lastWorkedOn`, set on any save made while a
 *     test is open -- no extra save, and it follows the teacher to another
 *     device. Settings are stored whole in teacher_workspaces.data, so the key
 *     round-trips with no migration (as settings.schoolYear does);
 *   - on this device (localStorage), the moment a test is opened, so a test
 *     only looked at still counts.
 * A test since deleted, or a class since removed, is never offered.
 */
import { assessmentInClass } from "./teacher-classes";
import type { Assessment, Classroom, Workspace } from "./teacher-types";

export type LastWorkedOn = { classId: string; assessmentId: string; at: string };

export const LAST_WORKED_ON_KEY = "tbf:last-worked-on";

/** The save carries where the teacher is: a test open on the assessments screen. */
export function withLastWorkedOn(next: Workspace, view: string, search: string, now: Date = new Date()): Workspace {
  if (view !== "assessments") return next;
  const id = new URLSearchParams(search).get("id");
  if (!id || !next.assessments.some((a) => a.id === id)) return next;
  const lastWorkedOn: LastWorkedOn = { classId: next.activeClassId, assessmentId: id, at: now.toISOString() };
  return { ...next, settings: { ...next.settings, lastWorkedOn } };
}

const valid = (x: unknown): x is LastWorkedOn =>
  !!x &&
  typeof x === "object" &&
  typeof (x as LastWorkedOn).classId === "string" &&
  typeof (x as LastWorkedOn).assessmentId === "string" &&
  typeof (x as LastWorkedOn).at === "string";

/** A stored value read back, or null. */
export function parseLastWorkedOn(raw: string | null): LastWorkedOn | null {
  try {
    const x = raw ? JSON.parse(raw) : null;
    return valid(x) ? x : null;
  } catch {
    return null;
  }
}

/** Where "Pick up where you left off" goes: the newer of the two records whose
 * class and test still exist and still go together; null otherwise. */
export function resumeTarget(
  w: Pick<Workspace, "classes" | "assessments" | "settings">,
  onDevice: LastWorkedOn | null,
): { classroom: Classroom; assessment: Assessment } | null {
  const saved = valid(w.settings.lastWorkedOn) ? w.settings.lastWorkedOn : null;
  const candidates = [saved, onDevice].filter((x): x is LastWorkedOn => !!x).sort((a, b) => b.at.localeCompare(a.at));
  for (const c of candidates) {
    const classroom = w.classes.find((k) => k.id === c.classId);
    const assessment = w.assessments.find((a) => a.id === c.assessmentId);
    if (classroom && assessment && assessmentInClass(assessment, classroom.id)) return { classroom, assessment };
  }
  return null;
}
