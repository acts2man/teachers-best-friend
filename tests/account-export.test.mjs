// "The LEA may access, correct, export, and delete LEA student data at any
// time through the Service." An export that quietly dropped a class, or a
// student with no evidence yet, would satisfy the sentence and fail the
// promise -- so the test is that everything in the workspace comes back out.
//
// The other half is what must NOT come out: upload ids and object paths.
// Those images are already deleted, by design, when the teacher confirms a
// student's grading and at 30 days regardless. Naming files that no longer
// exist would be worse than saying plainly that there are none.
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

const X = bundle("lib/account-export.ts");
const G = bundle("lib/impersonation-guard.ts");
const exportRoute = fs.readFileSync(path.join(ROOT, "app/api/account/export/route.ts"), "utf8");
const adminRoute = fs.readFileSync(
  path.join(ROOT, "app/api/admin/export/[teacherId]/route.ts"),
  "utf8",
);
const teacherServer = fs.readFileSync(path.join(ROOT, "lib/teacher-server.ts"), "utf8");

/** A classroom with every shape that matters, upload ids scattered through it. */
function workspace() {
  return {
    classes: [
      { id: "c1", name: "Period 2 Math", grade: 4, framework: "California", demo: false },
      { id: "c2", name: "Period 3, Reading", grade: 5, framework: "California", demo: false },
    ],
    activeClassId: "c1",
    students: [
      {
        id: "s1",
        classId: "c1",
        name: "Ada",
        color: "",
        notes: "Works better with a number line",
        evidence: [
          { id: "e1", standard: "4.OA.A.3", score: 80, date: "2026-09-01", source: "Quiz", assessmentId: "a1" },
          { id: "e2", standard: "4.NBT.B.4", score: 60, date: "2026-09-08", source: "Quiz", assessmentId: "a1" },
        ],
      },
      {
        id: "s2",
        classId: "c1",
        name: 'Bo "BJ" Nguyen',
        color: "",
        notes: "",
        evidence: [
          { id: "e3", standard: "4.OA.A.3", score: 95, date: "2026-09-01", source: "Quiz", assessmentId: "a1" },
        ],
      },
      // No evidence yet. A roster with the quiet students missing is not a roster.
      { id: "s3", classId: "c2", name: "Cleo", color: "", notes: "", evidence: [] },
    ],
    assessments: [
      {
        id: "a1",
        classId: "c1",
        title: "Two-step problems, week 3",
        subject: "Math",
        grade: 4,
        framework: "California",
        createdAt: "2026-09-01",
        status: "Ready",
        source: "ai",
        targetStandards: ["4.OA.A.3"],
        questions: [{ id: "q1", number: 1, text: "6 boxes of 24", answer: "144" }],
        responses: [{ studentId: "s1", questionId: "q1", answer: "144", correct: true }],
        uploadIds: ["up_aaaaaaaa"],
        answerKeyUploadIds: ["up_bbbbbbbb"],
        assignmentUploadIds: ["up_cccccccc"],
        studentUploadIds: { s1: ["up_dddddddd"] },
      },
      {
        id: "a2",
        classId: "c2",
        title: "The Lighthouse, comprehension",
        subject: "ELA",
        grade: 5,
        framework: "California",
        createdAt: "2026-09-10",
        status: "Draft",
        source: "manual",
        targetStandards: [],
        questions: [],
        responses: [],
        uploadIds: [],
      },
    ],
    lessons: [{ id: "l1", classId: "c1", title: "Bar diagrams", standard: "4.OA.A.3" }],
    resources: [{ id: "r1", title: "Number line poster", uploadId: "up_eeeeeeee", kind: "file" }],
    customStandards: [{ code: "LOCAL.1", title: "Explains their plan" }],
    groups: [{ id: "g1", classId: "c1", name: "Needs the number line", standard: "4.OA.A.3", studentIds: ["s1"] }],
    settings: { teacherName: "R. Munoz", school: "Example Elementary", reduceMotion: false },
  };
}

// ---------------------------------------------------------------
// Everything comes out
// ---------------------------------------------------------------

test("the JSON export contains every class, student and assessment", () => {
  const w = workspace();
  const out = X.buildExportJson(w, { generatedAt: "2026-09-21T23:00:00.000Z" });

  assert.equal(out.counts.classes, 2);
  assert.equal(out.counts.students, 3);
  assert.equal(out.counts.assessments, 2);

  const text = JSON.stringify(out);
  // Compared in their JSON-escaped form: one of these students has quotes in
  // their name, and looking for the raw characters would fail on an export
  // that is perfectly correct.
  const inJson = (value) => text.includes(JSON.stringify(value).slice(1, -1));
  for (const s of w.students) assert.ok(inJson(s.name), `student ${s.name} is in the export`);
  for (const a of w.assessments) assert.ok(inJson(a.title), `assessment ${a.title} is in the export`);
  for (const c of w.classes) assert.ok(inJson(c.name), `class ${c.name} is in the export`);
  // Not just the names: the work itself.
  assert.ok(text.includes("6 boxes of 24"), "question text survives");
  assert.ok(text.includes("Works better with a number line"), "teacher notes survive");
  assert.ok(text.includes("Bar diagrams"), "lessons survive");
  assert.equal(out.exportedAt, "2026-09-21T23:00:00.000Z");
});

// ---------------------------------------------------------------
// Nothing about images comes out
// ---------------------------------------------------------------

test("the JSON export contains no upload ids and no image paths", () => {
  const out = X.buildExportJson(workspace(), { generatedAt: "2026-09-21T23:00:00.000Z" });
  const text = JSON.stringify(out);
  for (const key of X.UPLOAD_KEYS)
    assert.ok(!text.includes(`"${key}"`), `${key} must not appear in the export`);
  // The values, not just the keys: a rename would not smuggle them out.
  for (const id of ["up_aaaaaaaa", "up_bbbbbbbb", "up_cccccccc", "up_dddddddd", "up_eeeeeeee"])
    assert.ok(!text.includes(id), `upload id ${id} must not appear`);
  assert.ok(/no upload|images and PDFs|deleted/i.test(out.note), "the export says why there are no images");
});

test("stripping upload refs reaches nested objects and arrays", () => {
  const nested = { a: [{ b: { uploadIds: ["x"], keep: 1 } }], object_path: "teacher/abc", keep: 2 };
  const clean = X.stripUploadRefs(nested);
  assert.deepEqual(clean, { a: [{ b: { keep: 1 } }], keep: 2 });
  // And it does not mutate what it was given.
  assert.deepEqual(nested.a[0].b.uploadIds, ["x"]);
});

// ---------------------------------------------------------------
// The CSV
// ---------------------------------------------------------------

test("the CSV has one row per piece of evidence, and one for a student with none", () => {
  const csv = X.buildExportCsv(workspace());
  const lines = csv.trim().split("\r\n");
  assert.equal(lines[0], X.CSV_HEADERS.join(","));
  // 2 for Ada + 1 for Bo + 1 placeholder for Cleo.
  assert.equal(lines.length - 1, 4);
  assert.ok(lines.some((l) => l.startsWith("Period 2 Math,4,Ada,4.OA.A.3,80,")));
  assert.ok(
    lines.some((l) => /Cleo,,,,,$/.test(l)),
    "a student with no evidence still appears, with empty columns",
  );
  // The assessment is named, not referenced by id.
  assert.ok(csv.includes("Two-step problems, week 3"));
  assert.ok(!csv.includes("a1,"), "no internal ids leak into the spreadsheet");
});

test("the CSV quotes commas and quotes the way a spreadsheet expects", () => {
  const csv = X.buildExportCsv(workspace());
  // A class name with a comma in it, and a student name with quotes in it.
  assert.ok(csv.includes('"Period 3, Reading"'));
  assert.ok(csv.includes('"Bo ""BJ"" Nguyen"'));
  assert.ok(csv.includes('"Two-step problems, week 3"'));
  assert.ok(csv.endsWith("\r\n"));
});

test("the CSV contains no upload ids either", () => {
  const csv = X.buildExportCsv(workspace());
  for (const id of ["up_aaaaaaaa", "up_bbbbbbbb", "up_cccccccc", "up_dddddddd", "up_eeeeeeee"])
    assert.ok(!csv.includes(id));
});

// ---------------------------------------------------------------
// Not while you are viewing someone else's account
// ---------------------------------------------------------------
//
// The export route resolved the teacher with owningTeacherId(), which during
// an admin view-as session resolves to the teacher being viewed. So an app
// manager could download that teacher's entire classroom -- every student
// name, every piece of evidence -- as a file, and nothing about it reached
// admin_audit_log. The start of the view is logged; the copy taken during it
// was not.

test("the guard refuses a download whenever the cookie is present", () => {
  // Presence, not resolution. A view-as session expires after 30 minutes; if
  // it lapses mid-view the cookie is still in the browser while the id
  // silently falls back to the manager's own, so "does it still resolve" is
  // the test that fails open into someone else's account.
  assert.equal(G.impersonationRefusal("any-session-token", "download"), G.IMPERSONATION_REFUSALS.download);
  assert.equal(G.impersonationRefusal("expired-but-still-set", "download"), G.IMPERSONATION_REFUSALS.download);
  // No cookie, no refusal.
  assert.equal(G.impersonationRefusal(undefined, "download"), null);
  assert.equal(G.impersonationRefusal(null, "download"), null);
  assert.equal(G.impersonationRefusal("", "download"), null);
});

test("downloads and writes are refused separately, and say different things", () => {
  assert.equal(G.impersonationRefusal("t", "write"), G.IMPERSONATION_REFUSALS.write);
  assert.notEqual(G.IMPERSONATION_REFUSALS.download, G.IMPERSONATION_REFUSALS.write);
  // The wording a teacher reads, matched to what they were actually doing.
  assert.match(G.IMPERSONATION_REFUSALS.download, /downloads are turned off/);
  assert.match(G.IMPERSONATION_REFUSALS.download, /Stop viewing to download your own data/);
  assert.match(G.IMPERSONATION_REFUSALS.write, /changes are turned off/);
});

test("the export route goes through the download guard, not owningTeacherId", () => {
  assert.ok(
    /const teacherId = await downloadingTeacherId\(\)/.test(exportRoute),
    "the export must resolve its teacher through downloadingTeacherId()",
  );
  // Comments stripped first: the route's own prose names owningTeacherId in
  // order to say why it is not used, and matching that would be the assertion
  // reading the explanation rather than the code.
  const code = exportRoute
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.ok(
    !/owningTeacherId/.test(code),
    "owningTeacherId resolves to the impersonated teacher and is what caused this",
  );
  assert.ok(
    /export async function downloadingTeacherId\(\) \{\s*await assertNotImpersonating\("download"\);/.test(
      teacherServer,
    ),
    "downloadingTeacherId must call the guard before resolving anyone",
  );
  assert.ok(
    /export async function assertNotImpersonating[\s\S]*?IMPERSONATION_COOKIE[\s\S]*?throw new HttpError\(403/.test(
      teacherServer,
    ),
    "and the guard must throw 403 on the cookie",
  );
});

// ---------------------------------------------------------------
// The audited door that replaces it
// ---------------------------------------------------------------

test("the admin export writes an audit row before handing the file over", () => {
  const auditAt = adminRoute.indexOf('p_action: "export_teacher_data"');
  const returnAt = adminRoute.indexOf("return new Response(body");
  assert.ok(auditAt > 0, "the admin export must log action export_teacher_data");
  assert.ok(returnAt > 0);
  assert.ok(auditAt < returnAt, "the audit line is written before the file is returned");
  // And a failed audit write refuses rather than handing over an unlogged copy.
  const between = adminRoute.slice(auditAt, returnAt);
  assert.ok(/if \(error\)/.test(between) && /throw new HttpError\(/.test(between),
    "a failed audit write must stop the export");
});

test("the admin export names the admin from the session, not the request", () => {
  assert.ok(/const admin = await requireAdmin\(\)/.test(adminRoute));
  assert.ok(/p_actor: admin\.id/.test(adminRoute));
  // teacherId comes from the path; the actor never does.
  assert.ok(!/p_actor:\s*teacherId/.test(adminRoute));
});

test("the admin audit detail carries counts, never content", () => {
  const detail = adminRoute.slice(adminRoute.indexOf("p_detail:"), adminRoute.indexOf("});", adminRoute.indexOf("p_detail:")));
  for (const key of ["classes", "students", "assessments", "format"])
    assert.ok(detail.includes(key), `detail records ${key}`);
  // Only lengths and the format string go in. An audit log that quoted what it
  // was auditing would be a second copy of the thing it exists to track.
  assert.ok(/\?\.length \?\? 0/.test(detail), "counts are lengths, not the rows themselves");
  assert.ok(!/workspace\.students\[|\.name|\.evidence/.test(detail), "no student content in the audit detail");
});

test("the admin export builds the same files the teacher's own download does", () => {
  // Two builders would drift, and a district would eventually receive
  // something different from what the teacher sees.
  assert.ok(/buildExportJson|buildExportCsv/.test(adminRoute));
  assert.ok(/from "@\/lib\/account-export"/.test(adminRoute));
});
