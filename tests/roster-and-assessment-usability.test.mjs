// Ricky's five usability fixes, tested where the logic actually lives.
//
// The pure pieces (roster order, points-out-of-total, deleting an assessment)
// are unit-tested against the real lib functions. The UI wiring (the auto-read
// staying on the page, the moved/reworded confirmations, the delete/rename
// controls) is checked structurally against the component source, the same way
// tests/retry-charges-once.test.mjs and tests/next-config-redirects.test.mjs
// guard component behaviour that has no DOM here.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const src = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const classes = bundle("lib/teacher-classes.ts");
const workflow = bundle("lib/teacher-workflow.ts");

// ---------------------------------------------------------------
// Item 4 — roster order: last initial, then first name.
// ---------------------------------------------------------------
test("compareByLastName sorts by last initial, then first name", () => {
  const { compareByLastName } = classes;
  const names = ["Maria G.", "Aaron Z.", "Bob A.", "Amy A."];
  const sorted = [...names].sort(compareByLastName);
  // A (Amy, then Bob), G (Maria), Z (Aaron): last initial first, first name to break ties.
  assert.deepEqual(sorted, ["Amy A.", "Bob A.", "Maria G.", "Aaron Z."]);
});

test("compareByLastName falls back to the first name when there is no last part", () => {
  const { compareByLastName } = classes;
  assert.deepEqual(["Cher", "Bono"].sort(compareByLastName), ["Bono", "Cher"]);
});

test("compareByLastName ignores case and accents", () => {
  const { compareByLastName } = classes;
  // Same last initial folded, same first name folded -> equal order.
  assert.equal(compareByLastName("Ana Üz.", "ana uz."), 0);
  // Case-insensitive last-initial ordering.
  assert.deepEqual(["bob b.", "Amy A."].sort(compareByLastName), ["Amy A.", "bob b."]);
});

// ---------------------------------------------------------------
// Item 5 — points out of total.
// ---------------------------------------------------------------
test("points and score label show a whole-test score both ways", () => {
  const { pointsForScore, scoreLabel } = workflow;
  assert.equal(pointsForScore(90, 20), 18);
  assert.equal(scoreLabel(90, 20), "90% · 18/20");
  assert.equal(pointsForScore(85, 20), 17);
  // Halves round up: 90% of 15 = 13.5 -> 14.
  assert.equal(pointsForScore(90, 15), 14);
  // No total set -> percentage only.
  assert.equal(pointsForScore(90), null);
  assert.equal(pointsForScore(90, 0), null);
  assert.equal(scoreLabel(90), "90%");
  // No score yet.
  assert.equal(pointsForScore(null, 20), null);
  assert.equal(scoreLabel(null, 20), "—");
});

// ---------------------------------------------------------------
// Item 3 — deleting an assessment cleans up, and leaves the rest.
// ---------------------------------------------------------------
test("deleteAssessment removes the assessment, its evidence, its lesson link, and its uploads", () => {
  const { deleteAssessment } = classes;
  const w = {
    assessments: [
      {
        id: "a1",
        uploadIds: ["u-shared"],
        assignmentUploadIds: ["u-page1", "u-page2"],
        answerKeyUploadIds: ["u-key"],
        studentUploadIds: { s1: ["u-s1a", "u-s1b"], s2: ["u-s2"] },
      },
      { id: "a2", uploadIds: ["keep"], assignmentUploadIds: ["keep2"] },
    ],
    students: [
      {
        id: "s1",
        evidence: [
          { id: "e1", assessmentId: "a1", standard: "x", score: 1, date: "", source: "" },
          { id: "e2", assessmentId: "a2", standard: "y", score: 1, date: "", source: "" },
        ],
      },
      { id: "s2", evidence: [{ id: "e3", assessmentId: "a1", standard: "z", score: 1, date: "", source: "" }] },
    ],
    lessons: [
      { id: "l1", assessmentId: "a1" },
      { id: "l2", assessmentId: "a2" },
    ],
  };
  const { workspace, uploadIds } = deleteAssessment(w, "a1");

  // The assessment is gone; the other one stays.
  assert.deepEqual(workspace.assessments.map((a) => a.id), ["a2"]);
  // Evidence from a1 is stripped from every student; a2 evidence survives.
  assert.deepEqual(workspace.students.find((s) => s.id === "s1").evidence.map((e) => e.id), ["e2"]);
  assert.deepEqual(workspace.students.find((s) => s.id === "s2").evidence, []);
  // Both students remain.
  assert.equal(workspace.students.length, 2);
  // The lesson's link to a1 is cleared; the a2 lesson is untouched.
  assert.equal(workspace.lessons.find((l) => l.id === "l1").assessmentId, undefined);
  assert.equal(workspace.lessons.find((l) => l.id === "l2").assessmentId, "a2");
  // Every kind of upload the assessment held is returned for deletion; nothing from a2.
  assert.deepEqual(
    [...uploadIds].sort(),
    ["u-key", "u-page1", "u-page2", "u-s1a", "u-s1b", "u-s2", "u-shared"].sort(),
  );
  assert.ok(!uploadIds.includes("keep") && !uploadIds.includes("keep2"));
});

// ---------------------------------------------------------------
// Item 1 — a multi-page assessment builds as ONE test.
// ---------------------------------------------------------------
test("the scan flow re-reads the whole set into one assessment instead of one per page", () => {
  const s = src("components/teacher-scan.tsx");
  // The just-created assessment becomes the edit target, so a re-read updates it.
  assert.ok(/const editId =[\s\S]*createdId/.test(s), "editId must include createdId");
  assert.ok(/setCreatedId\(a\.id\)/.test(s), "the created assessment id is remembered");
  // Auto-read stays on the page (navigate is gated); it does not leave after page 1.
  assert.ok(/if \(navigate\) go\("\/assessments\?id=" \+ a\.id\)/.test(s), "assignment navigation is gated behind navigate");
  assert.ok(/async function analyze\(ids\?: string\[\], navigate = false\)/.test(s), "analyze defaults to staying");
  // The read covers every uploaded page, not just the latest.
  assert.ok(/analyze\(\[\.\.\.files\.map\(\(f\) => f\.id\), \.\.\.uploadedIds\]\)/.test(s), "auto-read passes the whole set");
  // makeAssessment replaces questions (no duplication) and records the read pages.
  assert.ok(/questions,\n/.test(s), "questions are replaced, not appended");
  assert.ok(/storeIds: string\[\]/.test(s), "makeAssessment records the pages it read");
  // A way to leave once pages are read, and the manual path still exists.
  assert.ok(/Continue to review/.test(s), "there is a way to finish and review");
  assert.ok(/!autoReads &&[\s\S]*saveManual/.test(s), "the manual save path is kept where reading is unavailable");
});

// ---------------------------------------------------------------
// Item 2 — remove-from-roster is at the top, and destructive
// actions confirm with the permanent wording.
// ---------------------------------------------------------------
test("remove-from-roster is reachable from the student header and confirms permanently", () => {
  const s = src("components/teacher-insights.tsx");
  // The trigger sits in the profile heading (top), above the profile layout.
  const headingAt = s.indexOf("student-profile-heading");
  const removeBtnAt = s.indexOf("Remove from roster");
  const layoutAt = s.indexOf('className="profile-layout"');
  assert.ok(headingAt > 0 && removeBtnAt > headingAt && removeBtnAt < layoutAt, "remove trigger is in the header, not buried below");
  // Ricky's wording, on both destructive roster actions.
  assert.ok(/Are you sure you want to delete .* from the roster\?/.test(s), "uses the asked-for confirmation title");
  assert.equal(
    (s.match(/This is permanent and cannot be retrieved/g) || []).length,
    2,
    "both remove-student and clear-roster say it is permanent",
  );
});

// ---------------------------------------------------------------
// Item 3 / 5 — assessments can be renamed, given points, and deleted.
// ---------------------------------------------------------------
test("the assessment view offers edit (name + points) and a confirmed delete", () => {
  const s = src("components/teacher-assessments.tsx");
  assert.ok(/Edit assessment/.test(s), "an edit modal exists");
  assert.ok(/Points possible \(optional\)/.test(s), "points possible can be set when editing");
  assert.ok(/Delete “\{a\.title\}”\?/.test(s), "delete asks for confirmation naming the assessment");
  assert.ok(/permanently deletes the assessment/.test(s), "the delete dialog says what goes");
  assert.ok(/deleteAssessment\(w, a\.id\)/.test(s) && /deleteUploads\(uploadIds\)/.test(s), "delete cleans up workspace and uploads");
});

test("the create flow and the review score carry points too", () => {
  assert.ok(/Points possible \(optional\)/.test(src("components/teacher-scan.tsx")), "points can be set when creating");
  assert.ok(/pointsForScore\(summary\.score, a\.pointsPossible\)/.test(src("components/teacher-review.tsx")), "the review score shows points when set");
  assert.ok(/scoreLabel\(summary\.score, a\.pointsPossible\)/.test(src("lib/teacher-workflow.ts")), "the printable report shows points when set");
});
