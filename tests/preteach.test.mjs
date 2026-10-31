// Super grid step 2 (docs/design/super-grids.md): "Plan a pre-teach lesson"
// in a class super-grid cell. Proven when what reaches the AI is only the
// cluster, the DOK level, the cell's weakest standard codes and its error-type
// names with counts -- the cluster label and the standards' titles rebuilt by
// the server from its own catalog, anything forged dropped, a typed "Other"
// label sent only as "Other" -- and never a student's name, answer or score.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const G = bundle("lib/super-grid.ts");
const { buildPrompt } = bundle("lib/analyze-shared.ts");

// A made-up class: two tests on 7.RP at DOK 2, given this school year.
const NOW = new Date(2026, 9, 28, 12);
const q = (id, standard, dok) => ({ id, number: 1, text: "", passage: "", answer: "", standard, secondary: "", skill: "", dok, alignment: 90, confidence: 90, level: "", reasoning: "", verified: true, excluded: false });
const r = (studentId, questionId, match, errorType = "") => ({ id: studentId + questionId, studentId, questionId, answer: "Alpha wrote 7", correct: false, match, misconception: "", confidence: 90, verified: true, errorType, finalAnswer: "7" });
const quiz = {
  id: "t1", classId: "c1", title: "Quiz", subject: "Math", grade: 7, framework: "California", createdAt: "2026-10-01T00:00:00Z", dateGiven: "2026-10-20",
  status: "Ready", source: "manual", targetStandards: [], answerKeyVerified: true, uploadIds: [],
  questions: [q("a", "7.RP.1", 2), q("b", "7.RP.2.a", 2), q("c", "7.RP.3", 2), q("d", "7.RP.1", 1)],
  responses: [
    r("s1", "a", 25, "Sign Error"), r("s2", "a", 50, "Sign Error"),
    r("s1", "b", 50, "Other: forgot units"), r("s2", "b", 75),
    r("s1", "c", 100), r("s2", "c", 75, "Not on any list"),
    r("s1", "d", 100),
  ],
};
const w = {
  students: [{ id: "s1", classId: "c1", name: "Student Alpha" }, { id: "s2", classId: "c1", name: "Student Beta" }],
  assessments: [quiz], customStandards: [], sharedStandards: [], classes: [], lessons: [],
  settings: { teacherName: "", school: "", reduceMotion: false, schoolYear: 2026 },
};

test("the focus: the weakest graded standard, the next two, fixed-list error counts; nothing about a student", () => {
  const grid = G.classSuperGrid(w, { id: "c1", gradingMode: "percentage" }, NOW);
  const focus = G.preteachFocus(grid, "7.RP", 2);
  assert.deepEqual(focus.standard, { code: "7.RP.1", grade: 7, framework: "California" });
  assert.deepEqual(focus.also, ["7.RP.2.a", "7.RP.3"]);
  assert.equal(focus.dok, 2);
  assert.equal(focus.cluster, "7.RP");
  assert.deepEqual(focus.errorTypes, [{ name: "Sign Error", count: 2 }, { name: "Other", count: 1 }], "Other without the words; off-list dropped");
  assert.doesNotMatch(JSON.stringify(focus), /Alpha|Beta|wrote|forgot units|s1|s2/);
  assert.equal(G.preteachFocus(grid, "7.RP", 4), null, "a Not Tested cell has no lesson");
  assert.equal(G.preteachFocus(grid, "7.EE", 2), null);
});

const lesson = (extra) =>
  buildPrompt({ mode: "lesson", standard: "7.RP.1", grade: 7, framework: "California", text: "", duration: 15, modality: "Visual", ...extra }, w, [], true).task;

test("the prompt: a pre-teach lesson for the cluster, its other weak standards by catalog title, the errors -- nothing forged", () => {
  const task = lesson({
    intent: "preteach", cluster: "7.RP", alsoStandards: ["7.RP.2.a", "7.RP.3"], dok: [2],
    errorTypes: [{ name: "Sign Error", count: 2 }, { name: "Other", count: 1 }],
  });
  assert.match(task, /This is a pre-teach lesson, taught before the next unit -- not a reteach of a past test\./);
  assert.match(task, /weakest in the Ratios and Proportional Relationships · 7\.RP cluster on this standard and on 7\.RP\.2\.a \(/);
  assert.match(task, /7\.RP\.3 \(/);
  assert.match(task, /The most common mistakes in this cluster at that depth were: Sign Error \(2 answers\), Other \(1 answer\)\./);
  assert.match(task, /Pitch the modelling, the guided practice, the five practice problems and the exit questions at DOK 2\./);
  const forged = lesson({
    intent: "preteach", cluster: "Student Alpha failed", alsoStandards: ["Alpha", "7.RP.2.a"], dok: [2],
    errorTypes: [{ name: "Alpha wrote 7", count: 3 }, { name: "Other: forgot units", count: 1 }],
  });
  assert.doesNotMatch(forged, /Alpha|forgot units/, "a cluster, code or error name not from the lists never gets in");
  assert.match(forged, /on this standard and on 7\.RP\.2\.a \(/, "a real code still does");
});

test("the button sends only the focus: the lessons screen recomputes it from the class's own grid", () => {
  const panel = readFileSync("components/class-super-grid.tsx", "utf8");
  assert.match(panel, /Plan a pre-teach lesson/);
  assert.match(panel, /"&intent=preteach&cluster=" \+\s*encodeURIComponent\(f\.cluster\) \+\s*"&dok=" \+\s*f\.dok,/, "the link carries no errors or students");
  const planning = readFileSync("components/teacher-planning.tsx", "utf8");
  assert.match(planning, /preteachFocus\(classSuperGrid\(w, classroom\), params\.get\("cluster"\)!, dokLevels\[0\]\)/);
  const req = planning.slice(planning.indexOf("...(preteach\n"), planning.indexOf("setCustom(d.result);"));
  assert.match(req, /intent: "preteach" as const,\s*cluster: preteach\.cluster,\s*alsoStandards: preteach\.also,\s*dok: \[preteach\.dok\],\s*errorTypes: preteach\.errorTypes,/);
  assert.doesNotMatch(req, /students|studentIds|answer|name:/);
});

test("the data-flow doc and the three published pages say what a pre-teach lesson sends", () => {
  const flow = readFileSync("docs/student-data-flow.md", "utf8");
  assert.match(flow, /\*\*Pre-teach lessons from the class super grid/);
  assert.match(flow, /Section 4 re-checked 2026-10-28 for pre-teach lessons/);
  for (const page of ["how-we-use-ai", "privacy", "student-data-privacy"])
    assert.match(readFileSync(`content/legal/${page}.md`, "utf8").replace(/\s+/g, " "), /pre-teach lesson (planned )?from (your|the) class super grid/i, page);
});
