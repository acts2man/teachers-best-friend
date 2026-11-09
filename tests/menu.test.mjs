// The menu (Ricky, 23 Oct 2026). Proven when:
//   - New Assessment is on top, then Overview, Assessment Library, Classes,
//     Lesson Planning, Student Reports -- in that order;
//   - every page the app has is still linked from somewhere (none is left
//     reachable only by typing its address);
//   - Overview jumps back into the last class and test: the newer of the one
//     saved with the workspace and the one opened on this device, never a
//     deleted test or a class it is not in, and the save schema keeps it;
//   - Classes has a shortcut to each class's super grid;
//   - Lesson Planning opens on the class super grid with "Data-driven lesson"
//     (the class's weakest standard on the grid) and "Start from scratch";
//   - Student Reports opens with a student picker, then the student's super
//     grid and the two reports.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, () => ({}));
  return m.exports;
}
const L = bundle("lib/last-worked-on.ts");
const G = bundle("lib/super-grid.ts");
const app = readFileSync("components/teacher-app.tsx", "utf8");

test("New Assessment on top, then Overview, Assessment Library, Classes, Lesson Planning, Student Reports", () => {
  const nav = app.slice(app.indexOf("const nav = ["), app.indexOf("];", app.indexOf("const nav = [")));
  const items = [...nav.matchAll(/\{ id: "(\w+)", label: "([^"]+)"/g)].map((m) => m[2]);
  assert.deepEqual(items, ["Overview", "Assessment Library", "Classes", "Lesson Planning", "Student Reports"]);
  const side = app.slice(app.indexOf('<SidebarContent className="side-content">'));
  assert.ok(side.indexOf('className="new-scan"') < side.indexOf("{nav.map("), "New assessment above the list");
  assert.match(app, /view === "reports" \? \(\s*<StudentReportsView \/>/);
  assert.match(readFileSync("app/[view]/page.tsx", "utf8"), /"reports",/);
});

test("every page stays reachable from a link", () => {
  const page = readFileSync("app/[view]/page.tsx", "utf8");
  const views = [...page.slice(page.indexOf("const views = ["), page.indexOf("];")).matchAll(/"(\w+)"/g)].map((m) => m[1]).filter((v) => v !== "reteach");
  const src = readdirSync("components").filter((f) => f.endsWith(".tsx")).map((f) => readFileSync("components/" + f, "utf8")).join("\n");
  const inMenus = new Set([...app.matchAll(/\{ id: "(\w+)", label:/g)].map((m) => m[1]));
  const unreached = views.filter(
    (v) => !inMenus.has(v) && !new RegExp(`(go|push)\\(\\s*["'\`]/${v}["'?&#\`]|href=\\{?["'\`]/${v}["'?#\`]|open\\(c, "/${v}"\\)`).test(src),
  );
  assert.deepEqual(unreached, [], "pages with no link to them");
  // The pages that left the menu, and where they are now.
  assert.match(readFileSync("components/teacher-library.tsx", "utf8"), /go\("\/assessments"\)\}>\s*All assessments/);
  assert.match(readFileSync("components/teacher-home.tsx", "utf8"), /go\("\/assessments"\)/);
});

const ws = (extra = {}) => ({
  classes: [{ id: "c1", name: "Period 1" }, { id: "c2", name: "Period 2" }],
  assessments: [{ id: "t1", classId: "c1", title: "Fractions" }, { id: "t2", classId: "c2", title: "Ratios" }, { id: "t3", classId: "c1", classIds: ["c1", "c2"], title: "Shared" }],
  settings: { teacherName: "", school: "", reduceMotion: false },
  activeClassId: "c1",
  ...extra,
});

test("Overview picks up the last class and test: the newer record, and only one that still exists", () => {
  const saved = { classId: "c2", assessmentId: "t2", at: "2026-11-04T10:00:00Z" };
  const device = { classId: "c1", assessmentId: "t1", at: "2026-11-05T09:00:00Z" };
  const w = ws({ settings: { teacherName: "", school: "", reduceMotion: false, lastWorkedOn: saved } });
  assert.equal(L.resumeTarget(w, device).assessment.id, "t1", "opened on this device after the save");
  assert.equal(L.resumeTarget(w, { ...device, at: "2026-11-01T00:00:00Z" }).assessment.id, "t2", "saved more recently, from any device");
  assert.equal(L.resumeTarget(w, null).classroom.id, "c2");
  const deleted = { ...w, assessments: w.assessments.filter((a) => a.id !== "t1") };
  assert.equal(L.resumeTarget(deleted, device).assessment.id, "t2", "a deleted test is never offered");
  assert.equal(L.resumeTarget(ws(), { classId: "c1", assessmentId: "t2", at: "2026-11-05T00:00:00Z" }), null, "nor a test in another class");
  assert.equal(L.resumeTarget(ws(), null), null);
  assert.equal(L.parseLastWorkedOn("{not json"), null);
});

test("a save made while a test is open carries it; any other save does not", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  const out = L.withLastWorkedOn(ws(), "assessments", "?id=t1&tab=responses", now);
  assert.deepEqual(out.settings.lastWorkedOn, { classId: "c1", assessmentId: "t1", at: "2026-11-05T12:00:00.000Z" });
  assert.equal(L.withLastWorkedOn(ws(), "lessons", "?id=t1", now).settings.lastWorkedOn, undefined);
  assert.equal(L.withLastWorkedOn(ws(), "assessments", "?id=gone", now).settings.lastWorkedOn, undefined);
  assert.match(app, /next = withLastWorkedOn\(next, view, window\.location\.search\);/, "save() adds it -- no save of its own");
  const opened = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(opened, /localStorage\.setItem\(\s*LAST_WORKED_ON_KEY,/, "opening a test counts on this device");
});

test("the save keeps it: the settings schema names lastWorkedOn (z.object drops unknown keys)", () => {
  const { settingsSchema } = bundle("lib/settings-schema.ts");
  const lastWorkedOn = { classId: "c1", assessmentId: "t1", at: "2026-11-05T12:00:00.000Z" };
  const parsed = settingsSchema.parse({ teacherName: "", school: "", reduceMotion: false, lastWorkedOn });
  assert.deepEqual(parsed.lastWorkedOn, lastWorkedOn, "a listed key survives the save schema");
  // An UNLISTED key is dropped -- which is exactly why lastWorkedOn has to be
  // named (the bug this guards against: a new setting silently lost on save).
  const stripped = settingsSchema.parse({ teacherName: "", school: "", reduceMotion: false, somethingNew: 1 });
  assert.ok(!("somethingNew" in stripped), "z.object strips an unlisted settings key");
  // A bad lastWorkedOn shape is rejected, not silently stored.
  assert.throws(() => settingsSchema.parse({ teacherName: "", school: "", reduceMotion: false, lastWorkedOn: { classId: 1 } }));
  // The route uses the shared schema, and the Workspace type declares the key,
  // so the two stay in lockstep.
  assert.match(readFileSync("app/api/workspace/route.ts", "utf8"), /settings: settingsSchema,/);
  assert.match(readFileSync("lib/teacher-types.ts", "utf8"), /lastWorkedOn\?: \{ classId: string; assessmentId: string; at: string \}/);
  assert.match(readFileSync("lib/settings-schema.ts", "utf8"), /lastWorkedOn:\s*z/);
  const home = readFileSync("components/teacher-home.tsx", "utf8");
  assert.match(home, /resumeTarget\(w, onDevice\)/);
  assert.match(home, /PICK UP WHERE YOU LEFT OFF/);
});

test("Classes has a shortcut to each class's super grid", () => {
  const classes = readFileSync("components/teacher-classes.tsx", "utf8");
  assert.match(classes, /aria-label=\{"Class super grid for " \+ c\.name\}\s*onClick=\{\(\) => open\(c, "\/lessons"\)\}/);
  assert.match(classes, /if \(c\.id !== classroom\.id && !\(await save\(\{ \.\.\.w, activeClassId: c\.id \}\)\)\)/, "it switches to that class first");
});

test("Lesson Planning opens on the class super grid with Data-driven lesson and Start from scratch", () => {
  const planning = readFileSync("components/teacher-planning.tsx", "utf8");
  const view = planning.slice(planning.indexOf("export function ReteachView("));
  const grid = view.indexOf("<ClassSuperGrid w={w} classroom={classroom} />");
  assert.ok(grid > 0 && grid < view.indexOf("Data-driven lesson") && grid < view.indexOf("Start from scratch"));
  assert.match(view, /\{choosing \? \(\s*<section className="panel lesson-start"/);
  assert.match(view, /go\("\/lessons\?start=scratch"\)/);
  // Data-driven starts on the class's weakest graded standard on the grid.
  const sc = (code, percent, answers) => ({ code, title: "", grade: 7, framework: "California", questions: 1, answers, percent, score4: null, level: percent === null ? null : { level: "x" } });
  const cell = (dok, standards) => ({ dok, standards });
  const g = { rows: [
    { label: "A", cells: [cell(1, [sc("7.RP.1", 80, 4)]), cell(2, [sc("7.RP.2", 40, 6), sc("7.RP.9", null, 0)])] },
    { label: "B", cells: [cell(3, [sc("7.EE.1", 40, 9)])] },
  ] };
  const w = G.weakestStandard(g);
  assert.deepEqual([w.code, w.dok, w.label], ["7.EE.1", 3, "B"], "lowest score; on a tie, the one with more answers; an ungraded one never");
  assert.equal(G.weakestStandard({ rows: [] }), null);
});

test("Student Reports: a student picker, then their super grid and the two reports", () => {
  const view = readFileSync("components/student-reports.tsx", "utf8");
  assert.match(view, /label="Choose a student"/);
  assert.ok(view.indexOf("<Pick") < view.indexOf("<StudentSuperGrid"));
  assert.match(view, /Student super grid report/);
  assert.match(view, /Standard Tracker report/);
  assert.match(view, /sections=\{report === "grid" \? \{ tracker: false \} : \{ superGrid: false \}\}/);
});
