// Reading assignments with a graphic organizer (Ricky): when the uploaded
// worksheet is a fill-in template -- labelled boxes like Characters, Setting,
// Motivation, Problem, Beginning, Middle, Ending, Solution, Lesson -- each box
// is one item graded against the story, and the read must NOT invent questions
// that are not printed on the page. This covers the assignment-read prompt that
// carries those instructions and the prompt-version bump that keeps a stored
// pre-organizer read from being served in its place. The real confirmation is a
// live read of one of Ricky's organizers (needs the AI provider); these guard
// the instructions the app actually sends.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";
import path from "node:path";

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

const shared = bundle("lib/analyze-shared.ts");
const { buildPrompt, READ_PROMPT_VERSION } = shared;
const src = readFileSync("lib/analyze-shared.ts", "utf8");

// Build the actual assignment-read prompt the app would send, so the organizer
// instructions are proven to land in the assignment branch -- not just present
// somewhere in the file.
const catalog = [
  { code: "RL.3.3", description: "Describe characters and explain how their actions contribute to the sequence of events", grade: 3, subject: "ELA", framework: "California" },
];
const workspace = { assessments: [], students: [], classes: [], lessons: [], groups: [], resources: [] };
const params = {
  mode: "assignment",
  uploadIds: ["u1"],
  subject: "ELA",
  grade: 3,
  framework: "California",
  targetStandards: ["RL.3.3"],
  text: "",
  passage: "Once upon a time a fox and a crow...",
  pageGroups: [],
  freshRead: false,
};
const built = buildPrompt(params, workspace, catalog, true);
const task = built.task;

test("the assignment read treats each labelled organizer box as one item", () => {
  assert.match(task, /graphic organizer or a fill-in template/i);
  assert.match(task, /each labelled box or field IS one item/i);
  // His actual box labels are named so the model recognises the template.
  for (const box of ["Characters", "Setting", "Motivation", "Problem", "Beginning", "Middle", "Ending", "Solution", "Lesson"])
    assert.match(task, new RegExp(box), `names the ${box} box`);
});

test("the read never invents questions that are not printed on the page", () => {
  assert.match(task, /never invent a question, prompt or box that is not there/i);
  assert.match(task, /do not merge, split, rename or reorder/i);
  assert.match(task, /only for a box that is actually printed/i);
});

test("organizer boxes are open items judged against the story, not a fixed key", () => {
  assert.match(task, /no single fixed answer/i);
  assert.match(task, /leave their answer key empty/i);
  assert.match(task, /judged against the story/i);
  // They are still classified like any item (standard/alignment/DOK/Costa).
  assert.match(task, /classify every box's standard, alignment, DOK and Costa/i);
  // The passage (the story) is still attached, so there is something to judge against.
  assert.match(task, /reading passage/i);
});

test("the read prompt version is bumped so a pre-organizer read is not reused", () => {
  assert.ok(READ_PROMPT_VERSION >= 4, "organizer handling changed the read, so the version bumps to >=4");
  assert.match(src, /v4: a graphic organizer/);
});
