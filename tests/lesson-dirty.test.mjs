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
