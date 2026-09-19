// The promise made to pilot teachers, checked against the prompts the app
// actually builds: no single request to the AI provider carries a student's
// name and that student's answers together, and the class roster is sent to
// neither. See docs/student-data-flow.md section 4.
//
// These assert on the built prompt text rather than on intent, so a future
// edit that quietly puts a name back in the grading call fails here.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import path from "node:path";

const ROOT = process.cwd();
const result = buildSync({
  entryPoints: ["lib/analyze-shared.ts"],
  bundle: true, platform: "node", format: "cjs", write: false,
  absWorkingDir: ROOT,
  alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
});
const shim = { exports: {} };
new Function("module", "exports", result.outputFiles[0].text)(shim, shim.exports);
const { buildPrompt, analyzeInput } = shim.exports;

const ROSTER = ["Maria Gonzalez", "Jamal Thompson", "Aiko Tanaka"];
const ANSWER = "42 apples";

const catalog = [{
  code: "7.RP.3", title: "Ratio and percent", subject: "Math", grade: 7,
  framework: "California", domain: "", cluster: "", wording: "w",
}];

const assessment = {
  id: "a1", classId: "c1", title: "Quiz", subject: "Math", grade: 7,
  framework: "California", createdAt: "", status: "Ready", source: "manual",
  targetStandards: ["7.RP.3"], answerKeyVerified: true,
  uploadIds: [], studentUploadIds: {}, responses: [],
  questions: [{
    id: "q1", number: 1, text: "How many apples?", passage: "", answer: ANSWER,
    standard: "7.RP.3", secondary: "", skill: "s", dok: 2, costas: 2,
    alignment: 90, confidence: 90, level: "On grade", reasoning: "",
    verified: true, excluded: false,
  }],
};

const workspace = {
  assessments: [assessment], lessons: [], classes: [{ id: "c1", name: "P2" }],
  students: ROSTER.map((name, i) => ({
    id: "s" + i, classId: "c1", name, color: "#000", evidence: [], notes: "",
  })),
};

const withPassage = (passage) => ({
  ...workspace,
  assessments: [{ ...assessment, passage }],
});

const promptFor = (extra, ws = workspace) => buildPrompt(
  analyzeInput.parse({
    grade: 7, subject: "Math", framework: "California",
    targetStandards: ["7.RP.3"], assessmentId: "a1", ...extra,
  }),
  ws, catalog, true,
).task;

const mentionsAnyName = (text) =>
  ROSTER.some((n) => text.includes(n) || text.includes(n.split(" ")[0]));

test("the grading pass is sent no student name and no roster", () => {
  const task = promptFor({
    mode: "class_scan", uploadIds: ["u1", "u2"], pageGroups: [[0], [1]],
  });
  assert.equal(mentionsAnyName(task), false, "a name reached the grading prompt");
  assert.match(task, /name has already been removed/i);
});

test("the grading pass is told the groups, so it never needs to read a name", () => {
  const task = promptFor({
    mode: "class_scan", uploadIds: ["u1", "u2", "u3"], pageGroups: [[0, 1], [2]],
  });
  assert.match(task, /"group":0/);
  assert.match(task, /"pages":\[0,1\]/);
});

test("the name pass is sent no questions, no answer key and no roster", () => {
  const task = promptFor({ mode: "name_strip", uploadIds: ["s1", "s2"] });
  assert.equal(mentionsAnyName(task), false, "a roster name reached the name prompt");
  assert.equal(task.includes(ANSWER), false, "the answer key reached the name prompt");
  assert.equal(task.includes("q1"), false, "a question id reached the name prompt");
});

test("the two passes never overlap: names in one, answers in the other", () => {
  const grading = promptFor({
    mode: "class_scan", uploadIds: ["u1"], pageGroups: [[0]],
  });
  const naming = promptFor({ mode: "name_strip", uploadIds: ["s1"] });
  // Grading knows the answers; naming does not. Neither knows the class.
  assert.ok(grading.includes(ANSWER), "grading should still see the answer key");
  assert.equal(naming.includes(ANSWER), false);
  assert.equal(mentionsAnyName(grading) || mentionsAnyName(naming), false);
});

test("single-student grading still sends no name", () => {
  const task = promptFor({
    mode: "responses", uploadIds: ["u1"], studentId: "s0",
  });
  assert.equal(mentionsAnyName(task), false, "a name reached the responses prompt");
});

test("a class scan with no grouping is refused rather than sent ungrouped", () => {
  assert.throws(
    () => promptFor({ mode: "class_scan", uploadIds: ["u1"], pageGroups: [] }),
    /Add scanned pages first/,
  );
});

// The shared reading passage: read once when it is uploaded, then carried with
// every student's grading. A comprehension answer cannot be marked honestly
// without the text it is about, and attaching the photographed pages to each
// student would pay to read the same story once per child.
const STORY = "The fox had never once considered forgiveness until that morning.";

test("a story reaches the grading pass once the teacher has uploaded one", () => {
  const task = promptFor(
    { mode: "responses", uploadIds: ["u1"], studentId: "s0" },
    withPassage(STORY),
  );
  assert.ok(task.includes(STORY), "the passage did not reach grading");
  assert.match(task, /against the passage as well as the teacher/i);
});

test("a whole-class scan is given the story too", () => {
  const task = promptFor(
    { mode: "class_scan", uploadIds: ["u1"], pageGroups: [[0]] },
    withPassage(STORY),
  );
  assert.ok(task.includes(STORY));
});

test("an assessment with no passage sends nothing extra, so math costs what it did", () => {
  const withOut = promptFor({ mode: "responses", uploadIds: ["u1"], studentId: "s0" });
  assert.equal(/shared reading passage/i.test(withOut), false);
});

test("the passage carries no student name into grading", () => {
  const task = promptFor(
    { mode: "class_scan", uploadIds: ["u1"], pageGroups: [[0]] },
    withPassage(STORY + " " + ROSTER.join(" ")),
  );
  // The passage is teacher-supplied text, so if a name is in it that is the
  // teacher's doing -- but the roster still must not be added by us.
  assert.equal(task.includes("Maria Gonzalez, Jamal Thompson"), false);
});

test("reading a passage is shown no questions, no answer key and no student work", () => {
  const task = promptFor({ mode: "passage", uploadIds: ["p1", "p2"] });
  assert.equal(task.includes(ANSWER), false, "the answer key reached the passage read");
  assert.equal(mentionsAnyName(task), false, "a roster name reached the passage read");
  assert.equal(task.includes("How many apples?"), false, "a question reached the passage read");
  assert.match(task, /transcribe/i);
  assert.match(task, /do not answer any question/i);
});
