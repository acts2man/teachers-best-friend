// PR6: a teacher uploads or photographs their own writing rubric and the AI
// turns it into editable traits, each with a suggested standard, keeping the
// state rubric as the default until they do.
//
// These cover the new 'rubric' analyze mode end to end at the JavaScript level
// (prompt, schema, reconciliation), the Supabase routing migration, the Sites
// routing, and the panel wiring that reads a rubric into the editable draft.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import path from "node:path";

const ROOT = process.cwd();
const result = buildSync({
  entryPoints: ["lib/analyze-shared.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  absWorkingDir: ROOT,
  alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
});
const shim = { exports: {} };
new Function("module", "exports", result.outputFiles[0].text)(shim, shim.exports);
const { buildPrompt, finalizeAnalysis, analyzeInput } = shim.exports;

const catalog = [
  {
    code: "W.5.2",
    title: "Informative writing",
    subject: "ELA",
    grade: 5,
    framework: "California",
    domain: "Writing",
    cluster: "",
    wording: "Write informative/explanatory texts.",
  },
];
const workspace = { assessments: [], students: [], classes: [], lessons: [] };

const rubricParams = analyzeInput.parse({
  mode: "rubric",
  grade: 5,
  subject: "ELA",
  framework: "California",
});

// ---------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------

test("rubric mode is a valid analyze mode", () => {
  assert.equal(rubricParams.mode, "rubric");
});

test("the rubric prompt asks for traits with a max, descriptor, and a catalog standard", () => {
  const { task } = buildPrompt(rubricParams, workspace, catalog, true);
  assert.match(task, /structured scoring traits/i);
  assert.match(task, /maximum score/i);
  assert.match(task, /descriptor/i);
  // It must pin standard suggestions to the supplied catalog, not invent codes.
  assert.match(task, /ONLY from the supplied catalog/i);
  assert.match(task, /W\.5\.2/);
});

test("a rubric read with no document and no text is refused", () => {
  assert.throws(() => buildPrompt(rubricParams, workspace, catalog, false));
});

// ---------------------------------------------------------------
// Reconciling the model output
// ---------------------------------------------------------------

test("a suggested standard the catalog contains is kept", () => {
  const out = finalizeAnalysis(
    rubricParams,
    {
      traits: [
        { name: "Evidence", max: 4, descriptor: "Uses facts.", standard: "W.5.2" },
      ],
    },
    workspace,
    catalog,
  );
  assert.equal(out.traits.length, 1);
  assert.equal(out.traits[0].standard, "W.5.2");
  assert.equal(out.traits[0].max, 4);
});

test("an invented standard code is dropped to empty, never confirmed", () => {
  const out = finalizeAnalysis(
    rubricParams,
    {
      traits: [
        { name: "Voice", max: 4, descriptor: "Has voice.", standard: "MADE.UP.9" },
      ],
    },
    workspace,
    catalog,
  );
  assert.equal(out.traits[0].standard, "");
});

test("a trait with no name is dropped", () => {
  const out = finalizeAnalysis(
    rubricParams,
    {
      traits: [
        { name: "  ", max: 4, descriptor: "x", standard: "" },
        { name: "Conventions", max: 2, descriptor: "Spelling.", standard: "" },
      ],
    },
    workspace,
    catalog,
  );
  assert.equal(out.traits.length, 1);
  assert.equal(out.traits[0].name, "Conventions");
});

// ---------------------------------------------------------------
// Routing: Supabase migration + Sites fallback
// ---------------------------------------------------------------

test("a migration routes the rubric stage on Supabase", () => {
  const sql = readFileSync(
    "supabase/migrations/20260930250000_rubric_pipeline_stage.sql",
    "utf8",
  );
  assert.match(sql, /insert into public\.pipeline_config/i);
  assert.match(sql, /'rubric'/);
  assert.match(sql, /on conflict \(stage\) do update/i);
});

test("the Sites build carries a fixed rubric route", () => {
  const server = readFileSync("lib/analyze-server.ts", "utf8");
  assert.match(server, /rubric: \{ model:/);
});

// ---------------------------------------------------------------
// The panel wiring
// ---------------------------------------------------------------

test("the writing rubric panel reads an uploaded rubric into editable traits", () => {
  const src = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(src, /mode: "rubric"/);
  assert.match(src, /Upload or photograph your rubric/);
  // Read traits become an editable draft with fresh ids, not scored directly.
  assert.match(src, /id: crypto\.randomUUID\(\)/);
  // The suggested standard is shown and editable per trait.
  assert.match(src, /d\.name \+ " standard"/);
  // The state rubric stays the default until the teacher uploads their own.
  assert.match(src, /state rubric is the\s*\n?\s*default/);
});
