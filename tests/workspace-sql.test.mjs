// "Move these answers to…" and "Swap answers" through the REAL workspace save
// (review of #203, reproduced on production: the save was refused with
// "duplicate key value violates unique constraint responses_legacy_key").
// Proven when, in a scratch Postgres holding production's schema and live
// sync_workspace / get_workspace_json (tests/fixtures/workspace-schema.sql)
// plus migration 20261104120000:
//   - the failure is reproduced: answers that keep their ids while changing
//     student are refused by responses_legacy_key;
//   - a swap and a move made with lib/answer-mixups.ts save, and read back
//     with each answer on its new student, its crop (answerRegion) and the
//     pages with it, no answer lost or doubled, the check marks cleared;
//   - Undo saves too, and reads back as before the move;
//   - checkPages survives a save and a reload (the migration works).
// Made-up placeholder data only (R8).
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { startScratchPg } from "./helpers/scratch-pg.mjs";

const ROOT = process.cwd();
function bundle(entry) {
  const r = buildSync({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, absWorkingDir: ROOT });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, () => ({}));
  return m.exports;
}
const M = bundle("lib/answer-mixups.ts");
const TEACHER = "11111111-1111-4111-8111-111111111111";

const region = (upload, y) => ({ uploadId: upload, x: 0.1, y, width: 0.5, height: 0.1 });
const resp = (id, studentId, q, answer, upload, y, extra = {}) => ({
  id, studentId, questionId: q, answer, correct: false, match: 50, misconception: "", confidence: 80, verified: false,
  finalAnswer: answer, answerRegion: region(upload, y), ...extra,
});
function workspace(responses, extra = {}) {
  return {
    classes: [{ id: "c1", name: "Class A", grade: 4, framework: "Common Core", demo: false }],
    students: ["s5", "s6", "s7"].map((id) => ({ id, classId: "c1", name: "Pupil " + id, color: "#000", evidence: [], notes: "" })),
    assessments: [{
      id: "t1", classId: "c1", title: "Organizer", subject: "ELA", grade: 4, framework: "Common Core", createdAt: "2026-11-02T12:00:00Z",
      status: "Ready", source: "ai", targetStandards: [], answerKeyVerified: true, uploadIds: [],
      questions: [{ id: "q1", number: 1, text: "Q1", answer: "k1", standard: "", verified: true, excluded: false }, { id: "q2", number: 2, text: "Q2", answer: "k2", standard: "", verified: true, excluded: false }],
      responses, studentUploadIds: { s5: ["page-5"], s6: ["page-6"] }, studentOrder: ["s5", "s6", "s7"], ...extra,
    }],
    lessons: [], resources: [], groups: [], customStandards: [], settings: {}, activeClassId: "c1",
  };
}
// The recorded swap: s5 holds the answers written on s6's page and the other way round, both marked.
const before = workspace([
  resp("r-5-1", "s5", "q1", "six wrote 1", "page-6", 0.2, { checkPages: true }), resp("r-5-2", "s5", "q2", "six wrote 2", "page-6", 0.4, { checkPages: true }),
  resp("r-6-1", "s6", "q1", "five wrote 1", "page-5", 0.2, { checkPages: true }), resp("r-6-2", "s6", "q2", "five wrote 2", "page-5", 0.4, { checkPages: true }),
]);

let pg;
test.before(() => {
  pg = startScratchPg();
  pg.file("tests/fixtures/workspace-schema.sql");
  pg.file("supabase/migrations/20261104120000_response_check_pages.sql");
});
test.after(() => pg?.stop());

const save = (ws) => pg.sql("select public.sync_workspace(:'tid'::uuid, :'ws'::jsonb);", { tid: TEACHER, ws: JSON.stringify(ws) });
const load = () => {
  const r = pg.sql("select public.get_workspace_json(:'tid'::uuid);", { tid: TEACHER });
  assert.ok(r.ok, r.err);
  return JSON.parse(r.out);
};
const answersOf = (ws, student) =>
  ws.assessments[0].responses.filter((r) => r.studentId === student).map((r) => r.questionId + ":" + r.answer + "@" + r.answerRegion?.uploadId).sort();

test("the first save, as the scan left it: the marks survive a reload", () => {
  const r = save(before);
  assert.ok(r.ok, r.err);
  const back = load();
  assert.equal(back.assessments[0].responses.length, 4);
  assert.ok(back.assessments[0].responses.every((x) => x.checkPages === true), "checkPages round-trips (migration 20261104120000)");
});

test("reproduced: answers that keep their ids while changing student are refused", () => {
  const kept = structuredClone(before);
  kept.assessments[0].responses = kept.assessments[0].responses.map((r) => ({ ...r, studentId: r.studentId === "s5" ? "s6" : "s5" }));
  const r = save(kept);
  assert.equal(r.ok, false);
  assert.match(r.err, /duplicate key value violates unique constraint "responses_legacy_key"/);
});

test("Swap answers saves: each answer on its new student, with its crop and pages, nothing lost or doubled", () => {
  const a = M.moveAnswers(before.assessments[0], "s5", "s6");
  const oldIds = new Set(before.assessments[0].responses.map((r) => r.id));
  assert.ok(a.responses.every((r) => !oldIds.has(r.id)), "every moved answer has a new id");
  const r = save({ ...before, assessments: [a] });
  assert.ok(r.ok, r.err);
  const back = load();
  assert.deepEqual(answersOf(back, "s5"), ["q1:five wrote 1@page-5", "q2:five wrote 2@page-5"]);
  assert.deepEqual(answersOf(back, "s6"), ["q1:six wrote 1@page-6", "q2:six wrote 2@page-6"]);
  assert.equal(back.assessments[0].responses.length, 4);
  assert.deepEqual(back.assessments[0].studentUploadIds, { s5: ["page-6"], s6: ["page-5"] }, "the pages go with the answers");
  assert.ok(back.assessments[0].responses.every((x) => x.checkPages === undefined), "the marks cleared");
  // Undo saves too, and reads back as before.
  const undone = M.undoMove(back.assessments[0], before.assessments[0], ["s5", "s6"]);
  const u = save({ ...before, assessments: [undone] });
  assert.ok(u.ok, u.err);
  const again = load();
  assert.deepEqual(answersOf(again, "s5"), answersOf(before, "s5"));
  assert.deepEqual(answersOf(again, "s6"), answersOf(before, "s6"));
  assert.deepEqual(again.assessments[0].studentUploadIds, { s5: ["page-5"], s6: ["page-6"] });
});

test("Move answers to a student with none saves, and Undo puts them back", () => {
  const now = load();
  const a = M.moveAnswers(now.assessments[0], "s5", "s7");
  const r = save({ ...now, assessments: [a] });
  assert.ok(r.ok, r.err);
  const back = load();
  assert.deepEqual(answersOf(back, "s5"), []);
  assert.deepEqual(answersOf(back, "s7"), answersOf(now, "s5"));
  assert.deepEqual(back.assessments[0].studentUploadIds.s7, ["page-5"]);
  const u = save({ ...back, assessments: [M.undoMove(back.assessments[0], now.assessments[0], ["s5", "s7"])] });
  assert.ok(u.ok, u.err);
  assert.deepEqual(answersOf(load(), "s5"), answersOf(now, "s5"));
});
