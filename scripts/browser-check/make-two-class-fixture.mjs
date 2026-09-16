// Ricky's shape: two classes at different grades and frameworks, plus the
// shared Grade 7 California library his second class needs. This is the setup
// that distinguishes "the data is missing" from "the screen is showing the
// wrong class", which reading the database alone cannot tell apart.
import { buildSync } from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const OUT = join(HERE, "out");

function bundle(p) {
  const r = buildSync({ entryPoints: [p], bundle: true, platform: "node", format: "cjs", write: false, loader: { ".json": "json" } });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const { createDemoWorkspace } = bundle(join(REPO, "lib/teacher-data.ts"));

// A slice of the real shared library: codes and titles copied from the rows
// get_workspace_json returns for this teacher, in the shape normalizeStandard
// produces.
const G7_CA = [
  ["7.RP.1", "Unit Rates with Fractions"], ["7.RP.2", "Recognize Proportional Relationships"],
  ["7.RP.3", "Solve Multistep Percent Problems"], ["7.NS.1", "Rational Addition and Subtraction"],
  ["7.NS.2", "Rational Multiplication and Division"], ["7.NS.3", "Solve Rational-Number Problems"],
  ["7.EE.1", "Operate on Linear Expressions"], ["7.EE.2", "Rewrite Expressions for Meaning"],
  ["7.EE.3", "Solve Multistep Real-Life Problems"], ["7.EE.4", "Model with Equations and Inequalities"],
  ["7.G.1", "Scale Drawings"], ["7.G.4", "Circle Measurements"], ["7.G.5", "Angle Relationships"],
  ["7.SP.1", "Random Samples and Populations"], ["7.SP.5", "Interpret Probability"],
];
const shared = G7_CA.map(([code, title]) => ({
  code, title, subject: "Math", grade: 7, domain: "", cluster: "",
  wording: title, summary: title, framework: "California",
  skills: [], prerequisites: [], next: [], vocabulary: [],
  misconception: "Use the student's written reasoning to identify the step that needs support.",
  example: "Choose a task that directly demonstrates this standard.", dok: 2, source: "",
}));

const w = createDemoWorkspace();
w.classes = [
  { ...w.classes[0], id: "demo", name: "The Explorers", grade: 4, framework: "Common Core", demo: true },
  { id: "math7", name: "Math 7", grade: 7, framework: "California", demo: false },
];
w.activeClassId = "math7";       // what impersonation lands on
w.sharedStandards = shared;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "fixture-two-class.json"), JSON.stringify(w));
console.log("classes:", w.classes.map((c) => `${c.name} (G${c.grade} ${c.framework})`).join(" + "));
console.log("active:", w.activeClassId, "| shared G7 California standards:", shared.length);
