// Writing test on a phone (Michael, 4 Nov 2026, Android/Brave). Proven when:
//   - "Add student work" brings the Student writing step into view: on main
//     it switched the tab 796 px down a 915 px screen with the panel below
//     it, so on a phone nothing changed in sight;
//   - the per-student upload offers the app's own camera ("Take a photo",
//     ScanCamera, with its framing guide and blur check), and the file
//     picker names its types instead of "image/*", which lets Android jump
//     straight to the phone's camera.
// scripts/browser-check/writing-phone.mjs reproduces both at 412x915.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("components/teacher-assessments.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");
const writing = src.slice(src.indexOf("function WritingReview("), src.indexOf("function WritingClassPanel("));

test("Add student work brings the step into view, below the sticky header", () => {
  const add = src.slice(src.lastIndexOf("<Action", src.indexOf("Add student work")), src.indexOf("Add student work"));
  assert.match(add, /setTab\("responses"\);/);
  assert.match(add, /document\.querySelector\("\.assessment-tabs"\)\?\.scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(css, /\.assessment-tabs\{scroll-margin-top:84px\}/);
});

test("a student's writing can be photographed with the app camera", () => {
  assert.match(writing, /onClick=\{\(\) => chooseWriting\("camera"\)\}/);
  assert.match(writing, /\{hasScores \? "Retake writing" : "Take a photo"\}/);
  assert.match(writing, /<ScanCamera\s+mode="single"/);
  assert.match(writing, /if \(files\.length\) void gradeEssay\(files\);/);
  // Replace still asks first, then opens the source the teacher chose.
  assert.match(writing, /function pickFiles\(replace: boolean\) \{[\s\S]*?open\(source\.current\);/);
});

test("the file picker names its types, and nothing asks for the phone's own camera", () => {
  const inputs = [...writing.matchAll(/<input[\s\S]*?\/>/g)].map((m) => m[0]);
  const picker = inputs.find((i) => /Upload writing for/.test(i));
  assert.ok(picker, "the upload input");
  assert.match(picker, /accept="application\/pdf,image\/jpeg,image\/png,image\/webp"/);
  assert.doesNotMatch(picker, /image\/\*|capture=/);
  assert.doesNotMatch(writing, /capture=/);
  // A camera the page cannot open falls back to the file picker.
  assert.match(writing, /onFallback=\{\(\) => \{\s*setCameraOpen\(false\);\s*input\.current\?\.click\(\);/);
});
