// Batch 5 (Ricky/Michael): the app moves the teacher forward on its own, so
// nobody hunts for the next step:
//   - after the worksheet is read -> review the questions;
//   - after "Done" on the camera -> (confirm names) grade -> confirming grades;
//   - after the class set is graded -> class analysis.
// These are navigation-wiring changes, asserted against the component source
// the way the other flow tests are.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scan = readFileSync("components/teacher-scan.tsx", "utf8");
const review = readFileSync("components/teacher-review.tsx", "utf8");
const classScan = readFileSync("components/teacher-class-scan.tsx", "utf8");

test("reading the worksheet moves straight on to reviewing the questions", () => {
  // The read button navigates (analyze(..., navigate=true, ...)), and the
  // assignment branch of analyze navigates to the assessment on success.
  assert.match(scan, /analyze\(undefined, true, true\)/, "the read button asks to navigate");
  assert.match(scan, /if \(navigate\) go\("\/assessments\?id=" \+ a\.id\)/, "a read lands on the review");
});

test("after the camera's Done, the class is graded and the teacher lands at confirming grades", () => {
  // saveAll grades the scanned stack and scrolls to grade-by-question (the
  // confirming-grades screen), not the slow one-student list.
  assert.match(classScan, /getElementById\("grade-by-question"\)/);
  assert.match(classScan, /scrollIntoView/);
});

test("once every question is graded, the teacher is taken to class analysis", () => {
  assert.match(review, /Every question is graded\./);
  assert.match(review, /go\("\/assessments\?id=" \+ a\.id \+ "&tab=analysis"\)/, "all-graded -> analysis tab");
});
