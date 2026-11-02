// Reviews of #191/#192 (28 Oct 2026). Proven when:
//   (a) an existing test's "Use this assessment in" dialog offers only classes
//       graded the same way (plus any it is already in), and says why the
//       others are missing;
//   (b) grading one student at a time sets the test's date given the way a
//       class set does -- the day it is graded, never over a day already set;
//   (c) re-saving a test's setup keeps its date given;
//   (d) the super grid says it counts students now on the class's roster.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const Y = bundle("lib/school-year.ts");

test("(a) the share dialog offers same-mode classes and the ones the test is in, and says why the rest are missing", () => {
  const src = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(src, /const sharesWith = \(c: Classroom\) =>\s*!!a && \(c\.id === a\.classId \|\| \(a\.classIds \|\| \[\]\)\.includes\(c\.id\) \|\| classGradingMode\(w, c\) === gradingModeOf\(a\)\);/);
  assert.match(src, /\{w\.classes\.filter\(\(c\) => sharesWith\(c\)\)\.map\(\(c\) => \(/);
  assert.match(src, /so\{" "\}\s*\{otherModeClasses === 1 \? "it can't" : "they can't"\} share this test\./);
});

test("(b) one student's grading sets the date given like a class set, never over a day already set", () => {
  assert.deepEqual(Y.withDateGiven({ id: "t" }, "2026-10-28"), { id: "t", dateGiven: "2026-10-28" });
  assert.deepEqual(Y.withDateGiven({ id: "t", dateGiven: "2026-10-20" }, "2026-10-28"), { id: "t", dateGiven: "2026-10-20" });
  assert.deepEqual(Y.withDateGiven({ id: "t", dateGiven: "junk" }, "2026-10-28"), { id: "t", dateGiven: "2026-10-28" });
  const review = readFileSync("components/teacher-review.tsx", "utf8");
  const upload = review.slice(review.indexOf("async function uploadPages("));
  assert.equal((upload.match(/withDateGiven\(\{\s*\.\.\.withFiles,/g) ?? []).length, 2, "the AI read and the typed-PDF read");
  assert.match(upload, /: withFiles,\s*captured\.length/, "pages alone (nothing graded) set no date");
  // The class set uses the same rule.
  assert.match(readFileSync("lib/teacher-class-scan.ts", "utf8"), /const dated = touchedIds\.size \? withDateGiven\(assessment, today\) : assessment;/);
});

test("(c) re-saving a test's setup keeps its date given", () => {
  const scan = readFileSync("components/teacher-scan.tsx", "utf8");
  const make = scan.slice(scan.indexOf("function makeAssessment("), scan.indexOf("async function saveManual("));
  assert.match(make, /\.\.\.\(editing && isDateString\(editing\.dateGiven\) \? \{ dateGiven: editing\.dateGiven \} : \{\}\),/);
});

test("(d) the super grid says whose answers it counts", () => {
  assert.match(readFileSync("components/class-super-grid.tsx", "utf8"), /Counts students now on this class&rsquo;s roster\./);
});
