// Lesson plan changes (Ricky, 27 Oct 2026). Proven when:
//   - one generate sends three requests side by side: the full lesson in the
//     chosen teaching approach and the flow alone in the other two, and the
//     teacher switches versions with the approach tabs (practice and exit
//     ticket stay one set);
//   - the lesson gains Game-Based Learning and a Performance Task (15-20 min,
//     small collaborative groups), in that order after the exit ticket;
//   - "Add question" asks for one more question at the same standard and DOK,
//     not repeating the section's own;
//   - the print has an answer key after the targeted practice and after the
//     exit ticket.
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
const L = bundle("lib/teacher-lessons.ts");
const { buildPrompt } = bundle("lib/analyze-shared.ts");
const planning = readFileSync("components/teacher-planning.tsx", "utf8");

const phase = (name) => ({ time: "0–5", name, text: name + " text" });
const full = {
  objective: "Goal", materials: ["Cards"], phases: [phase("See it")],
  practice: [{ q: "P1?", a: "p1" }, { q: "P2?", a: "p2" }], exit: [{ q: "E1?", a: "e1" }],
  game: { title: "Ratio Relay", materials: ["Cones"], steps: ["Run", "Solve"], connection: "Each leg is a ratio." },
  performanceTask: { title: "Plan a party", minutes: 18, groupSize: "Groups of 3–4", scenario: "Budget a class party.", steps: ["Plan", "Present"], success: ["Correct unit rates", "Clear reasoning"] },
};

test("three versions of the flow, one set of everything else; the approach tabs switch them", () => {
  const lesson = L.assembleLesson(full, "Visual", [["Kinesthetic", { materials: ["Blocks"], phases: [phase("Build it")] }], ["Auditory", null]]);
  assert.deepEqual(Object.keys(lesson.flows).sort(), ["Kinesthetic", "Visual"]);
  assert.equal(L.flowFor(lesson, "Kinesthetic").phases[0].name, "Build it");
  assert.equal(L.flowFor(lesson, "Visual").phases[0].name, "See it");
  assert.equal(L.flowFor(lesson, "Auditory").phases[0].name, "See it", "a version that did not come back falls back");
  assert.ok(!L.hasFlow(lesson, "Auditory"));
  assert.deepEqual(lesson.practice, full.practice, "practice is one set");
  const edited = L.withFlow(lesson, "Kinesthetic", { materials: ["Tiles"], phases: [phase("Sort it")] });
  assert.equal(L.flowFor(edited, "Kinesthetic").phases[0].name, "Sort it");
  assert.equal(L.flowFor(edited, "Visual").phases[0].name, "See it", "editing one version leaves the others");
  const old = { ...full, game: undefined, performanceTask: undefined };
  assert.equal(L.flowFor(old, "Auditory").phases[0].name, "See it", "a lesson from before has one flow");
});

test("one generate: the full lesson in the chosen approach and the flow in the other two, side by side", () => {
  const gen = planning.slice(planning.indexOf("async function generateAI("), planning.indexOf("async function addQuestion("));
  assert.match(gen, /Promise\.allSettled\(\[\s*analyzeRequest\(\{ \.\.\.base, modality: chosen, lessonPart: "full" \}\),\s*\.\.\.others\.map\(\(o\) => analyzeRequest\(\{ \.\.\.base, modality: o, lessonPart: "flow" \}\)\),/);
  assert.match(gen, /if \(full\.status === "rejected"\) throw full\.reason;/, "the full lesson is required; a missing flow is reported");
  assert.match(planning, /flowFor\(content, modality\)\.phases\.map/, "the flow on screen follows the approach tabs");
});

const w = { assessments: [], students: [], classes: [], lessons: [], customStandards: [], sharedStandards: [] };
const prompt = (extra) =>
  buildPrompt({ mode: "lesson", standard: "7.RP.1", grade: 7, framework: "California", text: "", duration: 15, modality: "Visual", ...extra }, w, [], true);

test("the full lesson adds Game-Based Learning and a Performance Task; a flow request writes the flow alone", () => {
  const f = prompt({ lessonPart: "full", modality: "Kinesthetic" });
  assert.match(f.task, /Teaching approach Hands-on: students learn by doing/);
  assert.match(f.task, /add a Game-Based Learning activity: fun, quick, played in the small group, and plainly practising this standard/);
  assert.match(f.task, /add a Performance Task: 15 to 20 minutes, done in small collaborative groups of 3 or 4, a real-world problem that stretches students/);
  assert.deepEqual(Object.keys(f.schema.properties), ["objective", "materials", "phases", "practice", "exit", "game", "performanceTask"]);
  assert.deepEqual(f.schema.properties.performanceTask.properties.minutes, { type: "integer", minimum: 15, maximum: 20 });
  const fl = prompt({ lessonPart: "flow", modality: "Auditory" });
  assert.match(fl.task, /^Write ONLY the lesson flow/);
  assert.match(fl.task, /Teaching approach Auditory: let the thinking be heard/);
  assert.deepEqual(Object.keys(fl.schema.properties), ["materials", "phases"], "no practice, exit, game or task paid for three times");
  assert.deepEqual(Object.keys(prompt({}).schema.properties).slice(-2), ["game", "performanceTask"], "absent part is the full lesson");
});

test("Add question: one more at the same standard and DOK, not repeating the section's own", () => {
  const q = prompt({ lessonPart: "question", section: "exit", dok: [2], existing: ["What is 3/4 of 12?", ""] });
  assert.match(q.task, /^Write ONE more exit-ticket question for a small-group lesson on \{"code":"7\.RP\.1"/);
  assert.match(q.task, /at the same standard and DOK 2, with its correct answer/);
  assert.match(q.task, /not repeat or closely copy any of the lesson's questions in that section: \["What is 3\/4 of 12\?"\]/);
  assert.deepEqual(Object.keys(q.schema.properties), ["q", "a"]);
  assert.match(prompt({ lessonPart: "question", section: "practice", existing: [] }).task, /targeted-practice question .* the same depth and difficulty/);
  const add = planning.slice(planning.indexOf("async function addQuestion("), planning.indexOf("async function recordExit("));
  assert.match(add, /lessonPart: "question",\s*section,\s*existing: content\[section\]\.slice\(0, 20\)\.map\(\(q\) => q\.q\.slice\(0, 600\)\),/);
  assert.equal((planning.match(/onClick=\{\(\) => void addQuestion\("(practice|exit)"\)\}/g) ?? []).length, 2, "in targeted practice and in the exit ticket");
});

test("the print: an answer key after the targeted practice and after the exit ticket, then the game, the task last", () => {
  const text = L.lessonPrintText({ ...full, flows: { Visual: { materials: ["Cards"], phases: [phase("See it")] } } }, {
    code: "7.RP.1", duration: "15", approach: "Visual", adaptation: "Make it visible.", notes: "n", phaseTime: () => "0–5",
  });
  const at = (s) => { const i = text.indexOf(s); assert.ok(i >= 0, s); return i; };
  const order = ["TARGETED PRACTICE\n1. P1?\n\n2. P2?", "ANSWER KEY · TARGETED PRACTICE\n1. p1\n2. p2", "EXIT TICKET\n1. E1?", "ANSWER KEY · EXIT TICKET\n1. e1",
    "GAME-BASED LEARNING · Ratio Relay", "PERFORMANCE TASK · Plan a party · 18 minutes · Groups of 3–4", "TEACHER NOTES"].map(at);
  assert.deepEqual(order, [...order].sort((x, y) => x - y), "in that order");
  assert.ok(text.indexOf("p1") > text.indexOf("P2?"), "answers come after the questions, not beside them");
  assert.equal(L.practicePrintText(full, true), "TARGETED PRACTICE\n1. P1?\n\n2. P2?\n\nANSWER KEY · TARGETED PRACTICE\n1. p1\n2. p2");
  assert.equal(L.practicePrintText(full, false), "1. P1?\n\n2. P2?");
});

test("the tabs: …, Exit ticket, Game-Based Learning, Performance Task last", () => {
  const tabs = planning.slice(planning.indexOf('<TabsList className="text-tabs">'), planning.indexOf("</TabsList>", planning.indexOf('<TabsList className="text-tabs">')));
  const order = ['value="lesson"', 'value="practice"', 'value="exit"', 'value="game"', 'value="task"'].map((v) => tabs.indexOf(v));
  assert.ok(order.every((x) => x >= 0) && order.every((x, i) => !i || x > order[i - 1]), String(order));
});
