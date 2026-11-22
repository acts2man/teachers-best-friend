// Would starting a new plan (or returning to the Start panel) throw away work
// the teacher has not saved? Basing this on `editing` alone was wrong (review
// of #216): edits made and then "Done editing", an "Add question", or a
// re-generate of an already-saved plan all leave `editing` false while the
// lesson on screen no longer matches what is stored -- so "New lesson plan"
// discarded them silently. The honest test is a diff against the saved copy.
//
// Rules:
//   - Nothing on screen to lose while choosing, or with no lesson at all.
//   - A generated lesson never saved (no savedId) is always unsaved work.
//   - Mid-edit (editing) always counts, even before a concrete change lands --
//     cancelling the edit session is itself a loss the teacher should confirm.
//   - An opened saved plan counts only when its content now differs from the
//     stored copy (edited, Add question, or re-generated); untouched, it does
//     not, so a read-only open needs no warning.
export function hasUnsavedLesson(args: {
  choosing: boolean;
  custom: unknown;
  savedId: string | null;
  editing: boolean;
  savedCustom: unknown;
}): boolean {
  const { choosing, custom, savedId, editing, savedCustom } = args;
  if (choosing || !custom) return false;
  if (!savedId) return true;
  if (editing) return true;
  return JSON.stringify(custom ?? null) !== JSON.stringify(savedCustom ?? null);
}
