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
  /** Metadata the teacher can change on a saved plan (notes, date, duration). */
  meta?: Record<string, unknown>;
  savedMeta?: Record<string, unknown>;
}): boolean {
  const { choosing, custom, savedId, editing, savedCustom, meta, savedMeta } = args;
  if (choosing || !custom) return false;
  if (!savedId) return true;
  if (editing) return true;
  // Compare by VALUE, not text: Postgres jsonb reorders object keys on a
  // workspace reload, so a plain JSON.stringify would flag an untouched plan as
  // unsaved (review of #216). A key-sorted canonical form is order-stable.
  if (stableStringify(custom ?? null) !== stableStringify(savedCustom ?? null)) return true;
  // Notes, date and duration are saved with the plan too (review of #216): an
  // edit to any of them, without a custom change, is still unsaved work.
  if (meta && savedMeta && stableStringify(meta) !== stableStringify(savedMeta)) return true;
  return false;
}

/** JSON with object keys sorted at every depth, so value-equal data with keys
 * in a different order serialises identically. Arrays keep their order. */
export function stableStringify(v: unknown): string {
  return JSON.stringify(canonical(v));
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = canonical((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}
