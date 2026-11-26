// "New lesson plan" was discarding unsaved edits without a confirm (review of
// #216). The guard, `unsavedWork`, was based on `editing` -- true only while
// the edit panel was open -- so three real losses slipped past it:
//   1. edits made, then "Done editing" (editing back to false),
//   2. an "Add question" (never flips editing at all),
//   3. a re-generate of an already-saved plan (editing stays false).
// It is now a diff against the stored copy (lib/lesson-dirty.ts). This pins all
// three, plus the cases that must NOT warn. Fails on 064eaed (no such module).
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, absWorkingDir: ROOT,
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, () => ({}));
  return m.exports;
}
const { hasUnsavedLesson } = bundle("lib/lesson-dirty.ts");

const saved = { objective: "Place value", phases: [{ name: "Launch", text: "go" }] };
const changed = { objective: "Place value", phases: [{ name: "Launch", text: "go further" }] };

test("the three cases New lesson plan used to discard silently all warn", () => {
  // 1. Edited, then "Done editing": editing is false but content differs.
  assert.equal(
    hasUnsavedLesson({ choosing: false, custom: changed, savedId: "plan-1", editing: false, savedCustom: saved }),
    true,
    "edits kept after Done editing",
  );
  // 2. "Add question": editing never turned on; a new question is in `custom`.
  assert.equal(
    hasUnsavedLesson({
      choosing: false,
      custom: { ...saved, practice: [{ q: "new?", a: "1" }] },
      savedId: "plan-1",
      editing: false,
      savedCustom: saved,
    }),
    true,
    "a question added but not saved",
  );
  // 3. Re-generate of a saved plan: editing false, custom is the new lesson.
  assert.equal(
    hasUnsavedLesson({ choosing: false, custom: changed, savedId: "plan-1", editing: false, savedCustom: saved }),
    true,
    "a re-generated saved plan",
  );
});

test("a generated-but-never-saved lesson is unsaved work", () => {
  assert.equal(
    hasUnsavedLesson({ choosing: false, custom: saved, savedId: null, editing: false, savedCustom: undefined }),
    true,
  );
});

test("mid-edit always counts, even before a concrete change", () => {
  assert.equal(
    hasUnsavedLesson({ choosing: false, custom: saved, savedId: "plan-1", editing: true, savedCustom: saved }),
    true,
  );
});

test("an untouched saved plan opened read-only needs no warning", () => {
  assert.equal(
    hasUnsavedLesson({ choosing: false, custom: saved, savedId: "plan-1", editing: false, savedCustom: saved }),
    false,
  );
});

test("jsonb reordering the keys on reload is not a false 'unsaved' (review of #216)", () => {
  // Same values, keys in a different order (as Postgres jsonb returns them).
  const onScreen = { objective: "O", materials: ["a", "b"], phases: [{ name: "L", text: "t", time: "0–5" }] };
  const reloaded = { phases: [{ time: "0–5", text: "t", name: "L" }], materials: ["a", "b"], objective: "O" };
  assert.equal(
    hasUnsavedLesson({ choosing: false, custom: onScreen, savedId: "plan-1", editing: false, savedCustom: reloaded }),
    false,
    "value-equal, key-reordered custom is not unsaved",
  );
  // Arrays still compare by order, so a real reordering of phases IS a change.
  const movedPhase = { objective: "O", materials: ["a", "b"], phases: [{ name: "L2", text: "t2", time: "5–9" }, { name: "L", text: "t", time: "0–5" }] };
  assert.equal(
    hasUnsavedLesson({ choosing: false, custom: movedPhase, savedId: "plan-1", editing: false, savedCustom: reloaded }),
    true,
  );
});

test("notes, date and duration edits on a saved plan count as unsaved (review of #216)", () => {
  const base = { choosing: false, custom: saved, savedId: "plan-1", editing: false, savedCustom: saved };
  const savedMeta = { notes: "", date: "2026-11-25", duration: 15 };
  assert.equal(hasUnsavedLesson({ ...base, meta: { ...savedMeta }, savedMeta }), false, "no meta change");
  assert.equal(
    hasUnsavedLesson({ ...base, meta: { ...savedMeta, notes: "added a note" }, savedMeta }),
    true,
    "a notes edit is unsaved",
  );
  assert.equal(
    hasUnsavedLesson({ ...base, meta: { ...savedMeta, date: "2026-12-01" }, savedMeta }),
    true,
    "a date edit is unsaved",
  );
  assert.equal(
    hasUnsavedLesson({ ...base, meta: { ...savedMeta, duration: 30 }, savedMeta }),
    true,
    "a duration edit is unsaved",
  );
});

test("nothing to lose while choosing, or with no lesson on screen", () => {
  assert.equal(
    hasUnsavedLesson({ choosing: true, custom: changed, savedId: null, editing: true, savedCustom: saved }),
    false,
    "the Start panel is not a lesson at risk",
  );
  assert.equal(
    hasUnsavedLesson({ choosing: false, custom: undefined, savedId: null, editing: false, savedCustom: undefined }),
    false,
    "a prepared (template) lesson with no custom edits",
  );
});
