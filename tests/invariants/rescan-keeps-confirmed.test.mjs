// RULE R6, gap G5: re-scanning a student never silently replaces the grades a
// teacher already confirmed. docs/system-map.md.
//
// Before: mergeStudentResponses let any re-read answer replace the prior one
// (unless the new one was blank), so a confirmed grade -- the teacher's own
// decision, with its error type and "graded on their own" mark -- became an
// unconfirmed AI read again, with no warning, from both the class scan and the
// one-student scan. #134 asked first only for re-reading the QUESTIONS.
//
// Now confirmed grades are kept unless the teacher, asked with the exact count
// (confirmedGradesAtRisk / rescanWarning), chose "Replace with the new scan".
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundle, rng, RUNS } from "./lib/bundle.mjs";

const W = bundle("lib/teacher-workflow.ts");
const C = bundle("lib/teacher-class-scan.ts");

const student = (id) => ({ id, classId: "c", name: "Student " + id, color: "#000", evidence: [], notes: "" });

function graded(R) {
  const questions = Array.from({ length: R.int(1, 5) }, (_, i) => ({
    id: "q" + i, number: i + 1, text: "", passage: "", answer: String(i), standard: "6.EE.1", secondary: "", skill: "",
    dok: 1, alignment: 100, confidence: 100, level: "On grade", reasoning: "", verified: true, excluded: false,
  }));
  const ids = Array.from({ length: R.int(1, 6) }, (_, i) => "s" + i);
  const responses = [];
  for (const s of ids)
    for (const q of questions)
      if (R.chance(0.8))
        responses.push({
          id: "r-" + s + "-" + q.id, studentId: s, questionId: q.id, answer: "a" + R.int(0, 9), correct: R.chance(0.5),
          match: R.pick([0, 50, 100]), misconception: "", confidence: 100, verified: R.chance(0.5),
          ...(R.chance(0.3) ? { errorType: "computation" } : {}), ...(R.chance(0.2) ? { gradedAlone: true } : {}),
        });
  return {
    a: { id: "a", classId: "c", title: "T", subject: "Math", grade: 6, framework: "California", createdAt: "", status: "Ready", questions, responses, uploadIds: [], source: "manual", targetStandards: [], studentUploadIds: {} },
    roster: ids.map(student),
  };
}

/** One scan of some of the class. A student may come back as TWO groups (fronts
 * and backs, a page scanned twice) -- the second goes through mergeSplitGroups,
 * which once undid "Keep" (#147 review). */
const rescan = (R, a, roster) =>
  roster.filter(() => R.chance(0.7)).flatMap((s) =>
    Array.from({ length: R.chance(0.3) ? 2 : 1 }, (_, k) => ({
      studentId: s.id, name: s.name, pageUploadIds: ["new-" + s.id + "-" + k],
      responses: a.questions.map((q) => ({ questionId: q.id, answer: R.chance(0.2) ? "" : R.pick(["re-read", "other read"]), verdict: R.pick(["match", "other", "unsure", "blank"]) })),
    })),
  );

test(`a re-scan keeps every confirmed grade unless the teacher chose to replace them (${RUNS} class sets)`, () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    const R = rng(seed);
    const { a, roster } = graded(R);
    const groups = rescan(R, a, roster);
    const after = C.applyScannedGroups(a, roster, "c", groups).assessment;
    for (const r of a.responses.filter((x) => x.verified)) {
      const now = after.responses.find((x) => x.studentId === r.studentId && x.questionId === r.questionId);
      assert.deepEqual(now, r, `seed ${seed}: confirmed ${r.id} was replaced without the teacher choosing it`);
    }
  }
});

test("the teacher is asked with the right count: exactly the confirmed grades the scan touches", () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    const R = rng(seed);
    const { a, roster } = graded(R);
    const scanned = [...new Set(rescan(R, a, roster).map((g) => g.studentId))];
    const risk = W.confirmedGradesAtRisk(a, scanned);
    assert.equal(risk.answers, a.responses.filter((x) => x.verified && scanned.includes(x.studentId)).length);
  }
});

test("the teacher's explicit Replace lets the new scan replace them, never duplicating", () => {
  let replacedSome = false;
  for (let seed = 1; seed <= 50; seed++) {
    const R = rng(seed);
    const { a, roster } = graded(R);
    const groups = rescan(R, a, roster);
    const after = C.applyScannedGroups(a, roster, "c", groups, { replaceConfirmed: true }).assessment;
    const keys = after.responses.map((r) => r.studentId + "/" + r.questionId);
    assert.equal(new Set(keys).size, keys.length, `seed ${seed}: a student+question saved twice`);
    for (const r of a.responses.filter((x) => x.verified)) {
      const now = after.responses.find((x) => x.studentId === r.studentId && x.questionId === r.questionId);
      if (now && now.answer === "re-read") replacedSome = true;
    }
  }
  assert.ok(replacedSome, "Replace never replaced a confirmed grade");
});

test("mergeStudentResponses: confirmed stays, unconfirmed is replaced, a blank never wipes an answer", () => {
  const prior = [
    { id: "p1", studentId: "s", questionId: "q1", answer: "4", correct: true, match: 100, misconception: "", confidence: 100, verified: true },
    { id: "p2", studentId: "s", questionId: "q2", answer: "7", correct: false, misconception: "", confidence: 100, verified: false },
    { id: "p3", studentId: "s", questionId: "q3", answer: "9", correct: false, misconception: "", confidence: 100, verified: false },
  ];
  const incoming = [
    { id: "n1", studentId: "s", questionId: "q1", answer: "5", correct: false, misconception: "", confidence: 100, verified: false },
    { id: "n2", studentId: "s", questionId: "q2", answer: "8", correct: false, misconception: "", confidence: 100, verified: false },
    { id: "n3", studentId: "s", questionId: "q3", answer: "", correct: false, misconception: "", confidence: 0, verified: false },
  ];
  assert.deepEqual(W.mergeStudentResponses(prior, incoming).map((r) => r.id), ["p1", "n2", "p3"]);
  assert.deepEqual(W.mergeStudentResponses(prior, incoming, true).map((r) => r.id), ["n1", "n2", "p3"]);
});

test("Keep keeps a confirmed grade the new read does not cover (an excluded question) (#147 review)", () => {
  const prior = [{ id: "p9", studentId: "s", questionId: "q9", answer: "4", correct: true, match: 100, misconception: "", confidence: 100, verified: true }];
  const incoming = [{ id: "n1", studentId: "s", questionId: "q1", answer: "5", correct: false, misconception: "", confidence: 100, verified: false }];
  assert.deepEqual(W.mergeStudentResponses(prior, incoming).map((r) => r.id), ["n1", "p9"]);
  assert.deepEqual(W.mergeStudentResponses(prior, incoming, true).map((r) => r.id), ["n1"]);
});

test("a second group of the same scan never undoes Keep (#147 review)", () => {
  const confirmed = { id: "old", studentId: "s", questionId: "q1", answer: "4", correct: true, match: 100, misconception: "", confidence: 0, verified: true };
  for (const second of ["4", "7"]) {
    const merged = C.mergeSplitGroups([confirmed], [{ id: "n", studentId: "s", questionId: "q1", answer: second, correct: false, misconception: "", confidence: 100, verified: false }]);
    assert.deepEqual(merged[0], confirmed, `a second read of "${second}" changed the confirmed grade`);
  }
});

test("all three scan paths ask before a re-scan can replace confirmed grades", () => {
  const strip = (f) => readFileSync(f, "utf8").replace(/\/\/.*$/gm, "");
  const panel = strip("components/teacher-class-scan.tsx");
  const save = panel.slice(panel.indexOf("async function saveAll("));
  const beforeApply = save.slice(0, save.indexOf("applyScannedGroups("));
  assert.match(beforeApply, /confirmedGradesAtRisk\(a, scannedIds\)\.answers > 0[\s\S]*setAskRescan\(scannedIds\);\s*return;/, "the class scan asks before applying");
  assert.match(save, /\{ replaceConfirmed: replaceConfirmed === true \}/, "and replaces only on the teacher's Replace");
  const one = strip("components/teacher-scan.tsx");
  assert.match(one, /mode === "responses" && rescanRisk\.answers > 0\s*\?\s*setAskRescan\(true\)/, "the one-student scan asks before reading");
  // The review screen's "Upload pages" / "Take a photo" for one student too.
  const review = strip("components/teacher-review.tsx");
  const upload = review.slice(review.indexOf("async function uploadPages("));
  assert.match(upload.slice(0, upload.indexOf("setUploading(true)")), /confirmedGradesAtRisk\(a, \[selected\]\)\.answers > 0[\s\S]*setAskRescan\(\{ studentId: selected, files: incoming \}\);[\s\S]*return;/, "the review screen asks before uploading");
  // The waiting pages carry the student they were picked for (#147 review 2).
  assert.match(upload, /if \(forStudent && forStudent !== selected\)[\s\S]*?return;/);
  assert.match(review, /uploadPages\(waiting\.files, false, waiting\.studentId\)/);
  assert.match(upload, /mergeStudentResponses\(\s*a\.responses\.filter\(\(r\) => r\.studentId === selected\),\s*d\.result\.responses as StudentResponse\[\],\s*replaceConfirmed === true,?\s*\)/);
  assert.match(one, /mergeStudentResponses\(\s*chosen!\.responses\.filter\(\(r\) => r\.studentId === studentId\),\s*d\.result\.responses,\s*replaceConfirmedGrades,?\s*\)/);
});
