// Reading a teacher's own rubric from a photo (Michael, 3 Nov 2026). The read
// on production (scan b7314d64, stage "rubric", a 1.3 MB JPEG) completed with
// seven traits, max 4, three with standard "" -- yet the screen said "This PDF
// couldn't be read" and the default rubric stayed. Proven when, with that
// exact result shape (placeholder text of the recorded lengths):
//   - every trait is kept, the empty standards left blank for the teacher and
//     the screen says how many need one (a blank standard is still scored);
//   - a real failure names the file and gives the server's own reason, the
//     other files still go, it is logged, and traits read earlier and not yet
//     saved are kept and pointed to.
// scripts/browser-check/rubric-photo.mjs drives the real screen at 412x915.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, () => ({}));
  return m.exports;
}
const R = bundle("lib/rubric-read.ts");
const A = bundle("lib/analyze-shared.ts");
const D = bundle("lib/teacher-data.ts");

// [name length, descriptor length, standard], as recorded.
const RECORDED = [[11, 109, ""], [10, 130, ""], [17, 160, "W.4.9"], [11, 120, "W.4.9"], [13, 118, ""], [12, 144, "W.4.4"], [11, 187, "L.4.2"]];
const traits = RECORDED.map(([n, d, standard], i) => ({ name: ("Trait " + (i + 1) + " xxxxxxxxxxxxxxxx").slice(0, n), max: 4, descriptor: "d".repeat(d), standard }));
const catalog = ["W.4.9", "W.4.4", "L.4.2", "W.4.3"].map((code) => ({ code, title: code, subject: "ELA", grade: 4, framework: "Common Core", domain: "", cluster: "", wording: "w" }));

test("the server keeps the recorded result whole, the empty standards included", () => {
  const p = A.analyzeInput.parse({ mode: "rubric", grade: 4, subject: "ELA", framework: "Common Core", uploadIds: ["u1"] });
  const out = A.finalizeAnalysis(p, { traits }, { assessments: [], students: [], classes: [], lessons: [] }, catalog);
  assert.equal(out.traits.length, 7);
  assert.deepEqual(out.traits.map((t) => t.standard), ["", "", "W.4.9", "W.4.9", "", "W.4.4", "L.4.2"]);
});

test("every trait becomes a draft row; an empty standard stays empty and the screen says to set it", () => {
  let n = 0;
  const draft = R.draftFromTraits(traits, () => "d" + n++);
  assert.equal(draft.length, 7);
  assert.equal(draft.filter((d) => d.standard === "").length, 3);
  assert.equal(
    R.rubricReadNotice(traits),
    "7 traits read from your rubric. 3 have no standard yet — set one in its Standard box below, or leave it blank (it is still scored). Check each one, then Save rubric.",
  );
  assert.equal(R.rubricReadNotice(traits.filter((t) => t.standard)), "4 traits read from your rubric. Check each one, then Save rubric.");
  // The R-A-C-E shape Michael described: four traits, two without a standard.
  assert.match(R.rubricReadNotice(traits.slice(0, 4)), /^4 traits read from your rubric\. 2 have no standard yet/);
});

test("a trait with no standard is still scored, and counts toward no standard's mastery", () => {
  let n = 0;
  const rubric = R.draftFromTraits(traits, () => "t" + n++);
  const a = {
    id: "a1", classId: "c1", title: "Essay", subject: "ELA", elaArea: "writing", grade: 4, framework: "Common Core", createdAt: "",
    status: "Ready", source: "manual", targetStandards: [], questions: [], uploadIds: [], rubric,
    responses: rubric.map((d) => ({ id: "r" + d.id, studentId: "s1", questionId: d.id, answer: "", correct: false, match: 75, rubricScore: 3, misconception: "", confidence: 90, verified: true })),
  };
  const [s] = D.reconcileEvidence([{ id: "s1", classId: "c1", name: "Student", color: "#000", evidence: [], notes: "" }], a);
  assert.deepEqual(s.evidence.map((e) => e.standard).sort(), ["L.4.2", "W.4.4", "W.4.9"]);
  assert.ok(!s.evidence.some((e) => !e.standard));
});

test("a real failure names the file, gives the server's reason, and keeps unsaved traits", () => {
  assert.equal(
    R.uploadFailureNotice("rubric.jpg", "This PDF couldn’t be read. Try exporting it again, or photograph the pages instead."),
    "“rubric.jpg” couldn’t be uploaded: This PDF couldn’t be read. Try exporting it again, or photograph the pages instead.",
  );
  assert.equal(R.readFailureNotice("The rubric couldn’t be read reliably.", 7), "The rubric couldn’t be read reliably. The 7 traits read earlier are still below — Save rubric to keep them.");
  assert.equal(R.readFailureNotice("The rubric couldn’t be read reliably.", 0), "The rubric couldn’t be read reliably.");
});

test("the screen: each file uploads on its own, failures are logged, a blank standard is marked", () => {
  const src = readFileSync("components/teacher-assessments.tsx", "utf8");
  const read = src.slice(src.indexOf("async function readRubric("), src.indexOf("Writing rubric\""));
  assert.match(read, /refused\.push\(uploadFailureNotice\(raw\.name \|\| "Your file", reason\)\)/, "one file failing names it and the others still go");
  assert.match(read, /logAppEvent\("api_failure"/);
  assert.match(read, /logAppEvent\("ai_failure", \{ message: reason, assessmentId: a\.id, detail: \{ mode: "rubric", kind: "error" \} \}\)/);
  assert.match(read, /setDraft\(draftFromTraits\(traits, /);
  assert.match(read, /readFailureNotice\(/);
  assert.doesNotMatch(read, /setNotice\(describeFailure\(e, "Your rubric couldn’t be read\."\)\);\s*\} finally/, "no catch-all that hides which step failed");
  assert.match(src, /No standard yet: set one, or leave it blank \(it is still scored\)\./);
});
