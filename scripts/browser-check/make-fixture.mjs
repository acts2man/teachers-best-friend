// Build a realistic workspace payload from the app's OWN demo generator, so the
// mock is the exact shape the client expects — not something I invented.
import { buildSync } from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const OUT = join(HERE, "out");
function bundle(p){const r=buildSync({entryPoints:[p],bundle:true,platform:"node",format:"cjs",write:false});const m={exports:{}};new Function("module","exports",r.outputFiles[0].text)(m,m.exports);return m.exports}
const { createDemoWorkspace } = bundle(join(REPO, "lib/teacher-data.ts"));
const w = createDemoWorkspace();
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "fixture.json"), JSON.stringify(w));
console.log("students:", w.students.length,
            "| classes:", w.classes.length,
            "| demo flag:", w.classes[0].demo,
            "| assessments:", w.assessments.length,
            "| evidence rows:", w.students.reduce((n,s)=>n+s.evidence.length,0));
