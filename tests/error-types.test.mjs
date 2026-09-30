// PR B: error types in Grade by question. When a teacher decides a group below
// full credit they can optionally tag it with an error type, one per group,
// changeable. The tag is stored on the responses and rolled up in Class view,
// per assessment and per standard, with the students who made each.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false,
    absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const { groupAnswers, applyGroupScore, setGroupErrorType, applyAnswerKey } =
  bundle("lib/teacher-workflow.ts");
const { errorTypesFor, ERROR_TYPES } = bundle("lib/error-types.ts");
const { classAnalysis, assessmentErrorTypes, tallyErrorTypes } =
  bundle("lib/teacher-class-analysis.ts");

const STANDARD = { code: "4.NBT.5", title: "Multiply", grade: 4, subject: "Math",
  framework: "California", domain: "", cluster: "", wording: "Multiply", summary: "",
  skills: [], prerequisites: [], next: [], vocabulary: [], misconception: "", example: "",
  dok: 2, source: "" };
function q(id, standard = "4.NBT.5") {
  return { id, number: 1, text: "", passage: "", answer: "12", standard, secondary: "",
    skill: "", dok: 2, alignment: 100, confidence: 100, level: "On grade", reasoning: "",
    verified: true, excluded: false };
}
function assessment(responses, questions = [q("q1")]) {
  return { id: "a", classId: "c", title: "T", subject: "Math", grade: 4,
    framework: "California", createdAt: "", status: "Ready", source: "manual",
    targetStandards: [], uploadIds: [], questions, responses };
}
function resp(id, questionId, answer, extra = {}) {
  return { id, studentId: "s-" + id, questionId, answer, correct: false, match: 50,
    misconception: "", confidence: 100, verified: true, ...extra };
}

test("the error type list lives in one place and holds Ricky's math types; ELA is empty for now", () => {
  assert.deepEqual(errorTypesFor("Math"), [
    "Algebraic/Arithmetic error", "Sign error", "Conceptual/Setup error",
    "Wrong formula", "Graph/Table interpretation error",
  ]);
  assert.deepEqual(errorTypesFor("ELA"), []);
  assert.deepEqual(errorTypesFor("Mixed"), ERROR_TYPES.Math, "mixed offers the math types until ELA has its own");
});

test("setGroupErrorType tags every response in the group without touching the score", () => {
  const a = assessment([resp("1", "q1", "10"), resp("2", "q1", "10")]);
  const after = setGroupErrorType(a, ["1", "2"], "Sign error");
  assert.ok(after.responses.every((r) => r.errorType === "Sign error"));
  assert.ok(after.responses.every((r) => r.match === 50 && r.verified === true), "score untouched");
  // Changeable: pick another, then clear it.
  const changed = setGroupErrorType(after, ["1", "2"], "Wrong formula");
  assert.ok(changed.responses.every((r) => r.errorType === "Wrong formula"));
  const cleared = setGroupErrorType(changed, ["1", "2"], "");
  assert.ok(cleared.responses.every((r) => r.errorType === ""));
});

test("groupAnswers surfaces the group's shared error type", () => {
  const a = assessment([
    resp("1", "q1", "10", { errorType: "Sign error" }),
    resp("2", "q1", "10", { errorType: "Sign error" }),
  ]);
  const g = groupAnswers(a, "q1")[0];
  assert.equal(g.errorType, "Sign error");
});

test("full credit carries no error type; a re-score below full keeps the tag", () => {
  const a = assessment([resp("1", "q1", "10", { errorType: "Sign error" })]);
  // Re-score to Half without passing a tag -> the existing tag survives.
  const half = applyGroupScore(a, ["1"], 50);
  assert.equal(half.responses[0].errorType, "Sign error");
  // Score to full credit -> the tag is dropped, because full credit is no error.
  const full = applyGroupScore(a, ["1"], 100);
  assert.equal(full.responses[0].errorType, "");
  // applyGroupScore can also set the tag as it scores.
  const tagged = applyGroupScore(a, ["1"], 0, "Conceptual/Setup error");
  assert.equal(tagged.responses[0].errorType, "Conceptual/Setup error");
});

test("changing the answer key clears a now-stale error type along with the grade", () => {
  const a = assessment([resp("1", "q1", "10", { errorType: "Sign error" })]);
  const after = applyAnswerKey(a, { q1: "different key" });
  assert.equal(after.responses[0].verified, false);
  assert.equal(after.responses[0].errorType, "");
});

test("Class view rolls error types up per assessment, most common first, with students", () => {
  const students = [
    { id: "s-1", name: "Ana", classId: "c", color: "#000", evidence: [], notes: "" },
    { id: "s-2", name: "Ben", classId: "c", color: "#000", evidence: [], notes: "" },
    { id: "s-3", name: "Cy", classId: "c", color: "#000", evidence: [], notes: "" },
  ];
  const a = assessment([
    resp("1", "q1", "10", { errorType: "Sign error" }),
    resp("2", "q1", "10", { errorType: "Sign error" }),
    resp("3", "q1", "9", { errorType: "Wrong formula" }),
  ]);
  const tally = assessmentErrorTypes(a, students);
  assert.equal(tally.length, 2);
  assert.equal(tally[0].errorType, "Sign error");
  assert.equal(tally[0].count, 2);
  assert.deepEqual(tally[0].students.map((s) => s.name), ["Ana", "Ben"]);
  assert.equal(tally[1].errorType, "Wrong formula");
});

test("per-standard breakdown attaches error types to the right standard", () => {
  const students = [
    { id: "s-1", name: "Ana", classId: "c", color: "#000", evidence: [], notes: "" },
  ];
  const a = assessment(
    [resp("1", "q1", "10", { errorType: "Sign error" })],
    [q("q1", "4.NBT.5")],
  );
  const rows = classAnalysis(a, students, [STANDARD]);
  const row = rows.find((r) => r.standard.code === "4.NBT.5");
  assert.ok(row);
  assert.equal(row.errorTypes.length, 1);
  assert.equal(row.errorTypes[0].errorType, "Sign error");
  assert.deepEqual(row.errorTypes[0].students.map((s) => s.name), ["Ana"]);
});

test("untagged answers produce no error-type rows", () => {
  const students = [{ id: "s-1", name: "Ana", classId: "c", color: "#000", evidence: [], notes: "" }];
  const a = assessment([resp("1", "q1", "10")]);
  assert.deepEqual(tallyErrorTypes(a.responses, students), []);
  assert.deepEqual(assessmentErrorTypes(a, students), []);
});

// --- component wiring ---
test("Grade by question offers an error-type picker for a decided, below-full group", () => {
  const ui = readFileSync("components/teacher-review.tsx", "utf8");
  assert.match(ui, /errorTypesFor\(a\.subject\)/, "reads the per-subject list");
  assert.match(ui, /Math\.round\(g\.match\) < 100/, "only below full credit");
  assert.match(ui, /setGroupErrorType\(a, group\.responseIds, errorType\)/, "tags the whole group");
  assert.match(ui, /value=\{g\.errorType\}/, "reflects the current tag");
});

test("Class analysis renders the error-type roll-up, assessment-wide and per standard", () => {
  const ui = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(ui, /assessmentErrorTypes\(a, students\)/, "computes the assessment-wide roll-up");
  assert.match(ui, /tallies=\{errorTypes\}/, "renders the assessment-wide list");
  assert.match(ui, /tallies=\{row\.errorTypes\}/, "renders the per-standard list");
});
