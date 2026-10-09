// Ricky's standards speed lane, and the guided student-work page (Ricky and
// Michael): one path -- scan, match names, grade by question -- with every
// other option still there under "More options".
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";

function bundle(p) {
  const r = buildSync({ entryPoints: [p], bundle: true, platform: "node", format: "cjs", write: false });
  const shim = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(shim, shim.exports);
  return shim.exports;
}
const W = bundle("lib/teacher-workflow.ts");

const q = (id, extra = {}) => ({
  id, number: 1, text: "t", passage: "", answer: "1", standard: "7.RP.3", secondary: "", skill: "s",
  dok: 2, alignment: 90, confidence: 90, level: "On grade", reasoning: "", verified: false, excluded: false, ...extra,
});
const a = (questions) => ({
  id: "a1", classId: "c1", title: "Quiz", subject: "Math", grade: 7, framework: "California", createdAt: "",
  status: "Needs review", source: "ai", targetStandards: ["7.RP.3"], uploadIds: [], questions, responses: [],
});

test("80% and up is strong; under 80 is not; a standard the teacher chose counts as strong", () => {
  assert.equal(W.alignmentIsStrong(q("q", { alignment: 80 })), true);
  assert.equal(W.alignmentIsStrong(q("q", { alignment: 79 })), false);
  assert.equal(W.alignmentIsStrong(q("q", { alignment: 0 })), true, "teacher-assigned (—) is strong");
});

test("one 'Looks good' confirms every question, weak ones included, and satisfies readiness", () => {
  const before = a([q("q1"), q("q2", { alignment: 55 }), q("q3", { alignment: 0 })]);
  const { assessment, confirmed, missingStandard } = W.confirmAllQuestions(before);
  assert.equal(confirmed, 3);
  assert.equal(missingStandard, 0);
  assert.ok(assessment.questions.every((x) => x.verified));
  assert.equal(assessment.status, "Ready");
  const gaps = W.preparationGaps({ ...assessment, answerKeyVerified: true });
  assert.equal(gaps.standards, 0, "nothing left for the readiness check to ask about");
  assert.equal(gaps.ready, true);
});

test("a question with no standard cannot be confirmed blind, and says so", () => {
  const { assessment, confirmed, missingStandard } = W.confirmAllQuestions(a([q("q1"), q("q2", { standard: "" })]));
  assert.equal(confirmed, 1);
  assert.equal(missingStandard, 1);
  assert.equal(assessment.status, "Needs review");
});

test("the question list shows green, red with a Strengthen? link, and one Looks good", () => {
  const ui = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(ui, /className="align-strong"/);
  assert.match(ui, /className="align-weak"/);
  assert.match(ui, /Strengthen\?/);
  assert.match(ui, /Looks good — confirm all/);
  assert.match(ui, /confirmAllQuestions\(a\)/);
});

test("the student work page is one guided path, with everything else under More options", () => {
  const scan = readFileSync("components/teacher-class-scan.tsx", "utf8");
  assert.match(scan, /className="guided-steps"/);
  assert.match(scan, /Scan student work/);
  assert.match(scan, /Match names/);
  assert.match(scan, /Grade by question/);
  assert.match(scan, /<summary>More options<\/summary>/);
  // Nothing removed: every old control is still reachable.
  for (const control of ["Choose files", "Next student", "Undo last", "Start over", "Upload a whole stack instead"])
    assert.ok(scan.includes(control), control + " is still there");
  const review = readFileSync("components/teacher-review.tsx", "utf8");
  assert.match(review, /More options: one student at a time/);
  assert.match(review, /useState\(!!params\.get\("student"\)\)/, "a link to one student opens it");
  const cam = readFileSync("components/scan-camera.tsx", "utf8");
  assert.match(cam, /mode === "class" \? "Finished" : "Done"/);
});
