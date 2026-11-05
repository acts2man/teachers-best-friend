/**
 * Reading a teacher's own writing rubric (Michael, 3 Nov 2026). On production
 * the read of a photographed rubric completed (scan b7314d64, stage "rubric":
 * seven traits, max 4 each, three with standard ""), yet the screen showed
 * "This PDF couldn't be read" and the default rubric stayed. The words here
 * keep those two things apart:
 *
 * - A trait with no standard is a normal result, not a failure: the model is
 *   only allowed a code the catalog has, so a trait like "Restate" often comes
 *   back with none. It is kept, left blank, and the teacher is told to set it
 *   (a trait with no standard is scored, it just counts toward no standard's
 *   mastery -- lib/teacher-data.ts reconcileEvidence).
 * - A real failure says which file and what went wrong, in the server's own
 *   words, and never touches traits already read and not yet saved.
 */
import type { RubricDimension } from "./teacher-types";

export type ReadTrait = { name: string; max: number; descriptor: string; standard: string };

/** The traits read, as editable draft rows. An empty standard stays empty. */
export function draftFromTraits(traits: ReadTrait[], newId: () => string): RubricDimension[] {
  return traits.map((t) => ({
    id: newId(),
    name: t.name,
    max: t.max,
    descriptor: t.descriptor,
    standard: (t.standard ?? "").trim(),
  }));
}

/** What the screen says after a read that came back with traits. */
export function rubricReadNotice(traits: Pick<ReadTrait, "standard">[]): string {
  const n = traits.length;
  const blank = traits.filter((t) => !(t.standard ?? "").trim()).length;
  return (
    (n === 1 ? "1 trait" : n + " traits") +
    " read from your rubric. " +
    (blank
      ? (blank === 1 ? "1 has" : blank + " have") +
        " no standard yet — set one in its Standard box below, or leave it blank (it is still scored). "
      : "") +
    "Check each one, then Save rubric."
  );
}

/** One file that could not be uploaded, by name, with the server's reason. */
export function uploadFailureNotice(fileName: string, reason: string): string {
  return "“" + fileName + "” couldn’t be uploaded: " + reason;
}

/** A failed read, and a reminder when traits read earlier are still unsaved. */
export function readFailureNotice(reason: string, unsavedTraits: number): string {
  return (
    reason +
    (unsavedTraits
      ? " The " + (unsavedTraits === 1 ? "trait" : unsavedTraits + " traits") + " read earlier " + (unsavedTraits === 1 ? "is" : "are") + " still below — Save rubric to keep them."
      : "")
  );
}
