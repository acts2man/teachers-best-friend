// Review of #216, blocker 1: a teacher taps Generate on standard A, then
// (while "Building your plan…") opens standard B. The A run finished and its
// lesson landed on B -- on a credit already spent. Two guards fix it:
//   - "New lesson plan" is disabled while a generate is running, so a second
//     generate cannot be started on top of the first; and
//   - every generate captures a run token at the start, anything that moves
//     the teacher on (the params effect, a focus change via reset, a new plan)
//     bumps it, and a result whose token is stale is dropped, not applied.
// Source-pinned so the mechanism cannot be quietly removed. Fails on 064eaed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("components/teacher-planning.tsx", "utf8");

test("New lesson plan is disabled while a generate is running", () => {
  assert.match(
    src,
    /<Action onClick=\{newPlan\} disabled=\{aiBusy\}>/,
    "the header action is disabled while aiBusy, so no second generate can start",
  );
});

test("a generate captures a run token and drops a stale result", () => {
  assert.match(src, /const runTokenRef = useRef\(0\)/, "a run token ref exists");
  assert.match(src, /const token = \+\+runTokenRef\.current;/, "captured at the start of the generate");
  // Applied only when still current AND still mounted: the drop guard sits
  // before setCustom/toasts, and returns a delivered-but-dropped lesson with a
  // truthful message instead of applying it (review of #216).
  assert.match(
    src,
    /if \(runTokenRef\.current !== token \|\| !mountedRef\.current\) \{[\s\S]*?A lesson was finished after you left the page[\s\S]*?return;\s*\n\s*\}[\s\S]*?setCustom\(outcome\.lesson\)/,
    "a stale/unmounted result returns before it is applied to the open lesson",
  );
  // The mounted flag is cleared on unmount so a cross-page navigation is caught.
  assert.match(src, /const mountedRef = useRef\(true\)/);
  assert.match(src, /mountedRef\.current = false/);
});

test("moving to another lesson, focus or new plan bumps the token", () => {
  // The params effect (navigation to another standard/plan) …
  assert.match(src, /runTokenRef\.current\+\+;\s*\n\s*\/\/ A fresh menu entry/);
  // … a focus change via reset …
  assert.match(src, /function reset\(st: string\) \{\s*\n\s*runTokenRef\.current\+\+;/);
  // … and starting a new plan.
  assert.match(src, /function startNewPlan\(\) \{\s*\n\s*runTokenRef\.current\+\+;/);
});

test("mid-generate credit-loss doors are blocked (review of #216, blocker 2)", () => {
  // (a) the Start-panel "Choose a focus directly" picker: routed through
  //     changeFocus (which waits while aiBusy) and disabled while creating.
  assert.match(src, /onChoose=\{changeFocus\}/, "ReteachStart focus pick goes through the aiBusy guard");
  assert.match(src, /label="Choose a reteach focus"[\s\S]*?disabled=\{creating\}/);
  // (b) Saved lesson plans -> Open lesson is disabled while a generate runs,
  //     with a note explaining why.
  assert.match(src, /Open lesson[\s\S]{0,40}/); // the control exists
  const open = src.slice(src.indexOf('<TabsContent value="plan">'), src.indexOf("Record exit check"));
  assert.match(open, /Your lesson is still being written\./, "the plan tab shows the note while aiBusy");
  assert.match(open, /disabled=\{aiBusy\}[\s\S]*?Open lesson/, "Open lesson is disabled while aiBusy");
});

test("a failed generate's error toast is run-token-guarded (review of #216, nit 9)", () => {
  // The catch must not toast about a lesson the teacher has moved on from.
  assert.match(
    src,
    /\} catch \(e\) \{[\s\S]*?if \(runTokenRef\.current === token\)\s*\n\s*toast\.error\(describeFailure\(e, "The lesson couldn’t be created\."\)\);/,
  );
});

test("Add question carries the run token too (review of #216, blocker 7)", () => {
  const add = src.slice(src.indexOf("async function addQuestion("), src.indexOf("async function recordExit("));
  assert.match(add, /const token = runTokenRef\.current;/, "token captured at the start (not bumped)");
  assert.match(add, /if \(runTokenRef\.current !== token\) return;[\s\S]*?setCustom\(/, "dropped if stale, before setCustom");
  assert.match(add, /if \(runTokenRef\.current === token\)\s*\n\s*toast\.error/, "error toast guarded too");
});
