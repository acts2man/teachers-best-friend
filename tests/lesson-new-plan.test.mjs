// Ricky, 13 Nov 2026: "stuck, won't let me create a new lesson plan." Once a
// teacher had opened a saved plan, the Saved tab, or finished a Generate,
// `choosing` was false and the only "Start a lesson" entry point (the panel
// with Data-driven / Start from scratch) was gone, with nothing to bring it
// back. Proven fixed when there is a visible "New lesson plan" action from any
// planning state that returns to the Start panel by clearing the URL, guarded
// by a confirm when there is unsaved work.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("components/teacher-planning.tsx", "utf8");

test("a 'New lesson plan' action exists and is shown when not on the Start panel", () => {
  assert.match(src, /New lesson plan/, "the action is labelled");
  // Shown only when NOT choosing (the Start panel already offers it when choosing).
  assert.match(
    src,
    /\{!choosing && \(\s*<Action onClick=\{newPlan\} disabled=\{aiBusy\}>/,
    "rendered behind !choosing, so every non-empty planning state shows it (disabled mid-generate)",
  );
});

test("starting a new plan returns to the Start panel by clearing the URL params", () => {
  // choosing is true only when none of these params are present, so the way
  // back to the Start panel is a navigation to /lessons with no query.
  assert.match(src, /function startNewPlan\(\)\s*\{/);
  assert.match(src, /go\("\/lessons"\)/, "clears every param -> choosing is true again");
  // and the in-progress lesson is cleared so it can't leak into the new plan.
  assert.match(src, /function startNewPlan\(\)\s*\{[\s\S]*?setCustom\(undefined\)[\s\S]*?\}/);
});

test("unsaved work is confirmed before it is cleared", () => {
  // The decision is a diff against the saved copy (hasUnsavedLesson), not the
  // old `editing`-only test -- see lesson-dirty.test.mjs for the three cases.
  assert.match(src, /const unsavedWork = hasUnsavedLesson\(\{[\s\S]*?custom,[\s\S]*?savedCustom:[\s\S]*?\}\)/);
  assert.match(src, /function newPlan\(\)\s*\{\s*if \(unsavedWork\) setConfirmNew\(true\);\s*else startNewPlan\(\);/);
  assert.match(src, /Start a new lesson plan\?/, "the confirm dialog");
  assert.match(src, /open=\{confirmNew\}/);
});
