// The writing trait grid (Michael, 11 Nov 2026, "option A"): rubric traits down
// the side, score levels 1..max across, each box the count of students at that
// level on that trait, coloured by the level. Tapping a box offers "Reteach
// this trait", which sends ONLY the trait name, level and counts to the AI --
// never a student name (docs/student-data-flow.md section 4). No real database.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

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
const { writingTraitGrid } = bundle("lib/teacher-class-analysis.ts");
const { writingTraitReteachNote } = bundle("lib/teacher-lessons.ts");
const { rubricLevel } = bundle("lib/mastery-levels.ts");

const students = [
  { id: "s1", name: "Apart Namewon", color: "#1", classId: "c", evidence: [], notes: "" },
  { id: "s2", name: "Bea Nametwo", color: "#2", classId: "c", evidence: [], notes: "" },
  { id: "s3", name: "Cee Namethree", color: "#3", classId: "c", evidence: [], notes: "" },
  { id: "s4", name: "Dee Namefour", color: "#4", classId: "c", evidence: [], notes: "" },
];
const resp = (studentId, questionId, rubricScore, verified = true) => ({
  id: studentId + questionId, studentId, questionId, answer: "", correct: false, misconception: "",
  confidence: 100, verified, rubricScore,
});
const assessment = {
  id: "w1", classId: "c", title: "Opinion essay", subject: "ELA", elaArea: "writing", grade: 4,
  framework: "Common Core", createdAt: "2026-11-11", status: "Ready", uploadIds: [], source: "manual",
  targetStandards: [], questions: [],
  rubric: [
    { id: "t1", name: "Answer", max: 4, descriptor: "", standard: "W.4.1" },
    { id: "t2", name: "Cite Evidence", max: 4, descriptor: "", standard: "RI.4.1" },
  ],
  responses: [
    resp("s1", "t1", 4), resp("s2", "t1", 2), resp("s3", "t1", 2),
    // s4 has an UNVERIFIED suggestion on t1 -> must not count, and s4 is "not scored".
    resp("s4", "t1", 3, false),
    resp("s1", "t2", 3), resp("s2", "t2", 3),
  ],
};

test("the grid counts confirmed scores per trait per level, with the level's colour", () => {
  const rows = writingTraitGrid(assessment, students);
  assert.equal(rows.length, 2, "one row per rubric trait");
  const t1 = rows[0];
  assert.equal(t1.dimension.name, "Answer");
  assert.equal(t1.max, 4);
  assert.deepEqual(t1.cells.map((c) => c.level), [1, 2, 3, 4], "levels 1..max across");
  assert.deepEqual(t1.cells.map((c) => c.count), [0, 2, 0, 1], "two at level 2, one at level 4");
  assert.equal(t1.scored, 3, "the unverified s4 does not count");
  assert.deepEqual(t1.notScored.map((s) => s.id), ["s4"], "s4 has no confirmed score");
  assert.deepEqual(t1.cells[1].students.map((s) => s.id).sort(), ["s2", "s3"], "the right students at level 2");
  // Coloured by the level on the same 0–4 cuts as the DOK grid / class card.
  assert.equal(t1.cells[3].levelInfo.level, rubricLevel(4, 4).level);
  assert.equal(t1.cells[0].levelInfo.level, rubricLevel(1, 4).level);
  assert.notEqual(t1.cells[0].levelInfo.tone, t1.cells[3].levelInfo.tone, "level 1 and level 4 colour differently");
});

test("the reteach note carries only the trait name, level and counts — never a student name", () => {
  const note = writingTraitReteachNote({ trait: "Answer", level: 2, max: 4, counts: [0, 2, 0, 1] });
  assert.match(note, /Answer/);
  assert.match(note, /level 2 of 4/);
  assert.match(note, /0 at level 1, 2 at level 2, 0 at level 3, 1 at level 4/);
  for (const s of students) assert.doesNotMatch(note, new RegExp(s.name), "no student name in what the AI sees");
});

test("the grid's Reteach link sends trait name/level/counts and no student identity", () => {
  const src = readFileSync("components/writing-trait-grid.tsx", "utf8");
  // The reteach navigation carries exactly the non-identifying trait context…
  assert.match(src, /"&trait=" \+\s*encodeURIComponent\(row\.dimension\.name\)/);
  assert.match(src, /"&traitLevel=" \+\s*cell\.level/);
  assert.match(src, /"&traitMax=" \+\s*row\.max/);
  assert.match(src, /"&traitCounts=" \+\s*counts\.join\(","\)/);
  // …and never a student id or name in the URL it builds. Strip comments, then
  // check the navigation carries no student param or student-identity field.
  const start = src.indexOf("const reteach = () =>");
  const reteach = src
    .slice(start, src.indexOf('counts.join(",")', start) + 20)
    .replace(/\/\/[^\n]*/g, ""); // drop line comments (which may say "student")
  assert.doesNotMatch(reteach, /student=|students=|\.studentId|cell\.students/, "no student id or name goes into the reteach URL");
});
