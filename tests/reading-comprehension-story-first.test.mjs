// PR3: reading comprehension asks for the story first, then reads the questions
// against it.
//
// Michael: for a reading-comprehension test the questions only make sense with
// the passage. The setup now takes the story before the questions, attaches it
// to the question read so each question is classified against the text, keeps it
// on the assessment (it already rode grading), and shows the ELA area in the
// chips. The passage is the published story, not anything a student wrote
// (docs/student-data-flow.md section 4).
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

const { buildPrompt, analyzeInput, READ_PROMPT_VERSION } = bundle("lib/analyze-shared.ts");
const { readReuseFingerprint } = bundle("lib/analyze-server.ts");

const catalog = [
  { code: "RL.4.1", title: "Refer to details", subject: "ELA", grade: 4, framework: "California", domain: "Reading", cluster: "", wording: "w" },
];
const workspace = { assessments: [], students: [], classes: [], lessons: [] };
const base = {
  mode: "assignment",
  grade: 4,
  subject: "ELA",
  framework: "California",
  targetStandards: ["RL.4.1"],
};

// ---------------------------------------------------------------
// The passage rides the question read
// ---------------------------------------------------------------

test("the assignment read accepts a passage and puts it in the prompt", () => {
  const p = analyzeInput.parse({ ...base, passage: "Once upon a time the fox ran." });
  const { task } = buildPrompt(p, workspace, catalog, true);
  assert.match(task, /reading passage/i);
  assert.match(task, /Once upon a time the fox ran\./);
  // It must tell the model to classify against the passage, not answer it.
  assert.match(task, /do not .*answer it yourself/i);
});

test("with no passage, no passage clause is added", () => {
  const p = analyzeInput.parse(base);
  const { task } = buildPrompt(p, workspace, catalog, true);
  assert.doesNotMatch(task, /Reading passage:/);
});

test("the read prompt version was bumped for the passage change", () => {
  // The passage change took it to 3; later read-prompt changes bump it further
  // (v4: graphic organizers), so this guards that it never falls back below 3.
  assert.ok(READ_PROMPT_VERSION >= 3);
});

// ---------------------------------------------------------------
// A passage read never reuses a no-passage read
// ---------------------------------------------------------------

test("the reuse fingerprint distinguishes passage from no passage, and different passages", async () => {
  const svc = {
    from() {
      const q = {
        select: () => q,
        eq: () => q,
        in: () => q,
        then: (r) => r({ data: [{ id: "u1", content_sha256: "h1" }], error: null }),
      };
      return q;
    },
  };
  const none = await readReuseFingerprint(svc, "t1", analyzeInput.parse({ ...base, uploadIds: ["u1"] }));
  const withP = await readReuseFingerprint(svc, "t1", analyzeInput.parse({ ...base, uploadIds: ["u1"], passage: "hello world" }));
  const otherP = await readReuseFingerprint(svc, "t1", analyzeInput.parse({ ...base, uploadIds: ["u1"], passage: "a different, longer passage here" }));
  assert.notEqual(none, withP, "no passage vs passage must differ");
  assert.notEqual(withP, otherP, "different passages must differ");
});

// ---------------------------------------------------------------
// Setup UI: story first, passage attached, stored, ELA area chip
// ---------------------------------------------------------------

test("the scan setup takes the story before the questions for reading comprehension", () => {
  const src = readFileSync("components/teacher-scan.tsx", "utf8");
  assert.match(src, /const isReading =/);
  assert.match(src, /isReading && \(/, "a reading-only passage section is rendered");
  assert.match(src, /1\. The reading passage/);
  assert.match(src, /2\. Now add the questions/);
  // The read carries the passage, and the created assessment stores it.
  assert.match(src, /passage: isReading && passage\.trim\(\) \? passage : undefined/);
  assert.match(src, /passage: isReading && passage\.trim\(\) \? passage\.trim\(\) : editing\?\.passage/);
});

test("the scope chips show the ELA area", () => {
  const src = readFileSync("components/teacher-scan.tsx", "utf8");
  assert.match(src, /subject === "ELA" && elaAreaLabel\(elaArea\) && \(\s*\n?\s*<Pill>\{elaAreaLabel\(elaArea\)\}<\/Pill>/);
});

// ---------------------------------------------------------------
// Documented against the data-flow record
// ---------------------------------------------------------------

test("the data-flow doc records the passage riding the question read", () => {
  const doc = readFileSync("docs/student-data-flow.md", "utf8");
  assert.match(doc, /attached to the `assignment` question read/);
  assert.match(doc, /No identifier is added/);
});
