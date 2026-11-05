// Class analysis folds (Ricky, 19 and 29 Oct 2026: "could we make the groups
// under each standard a drop-down list? It is daunting to scroll through all
// the students"). Proven when every section of the Class analysis and every
// level group under a standard is a fold, open by default, that shows a short
// summary when closed. scripts/browser-check/collapsible-analysis.mjs clicks
// through it at phone and computer size.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shared = readFileSync("components/teacher-shared.tsx", "utf8");
const page = readFileSync("components/teacher-assessments.tsx", "utf8");
const panel = page.slice(page.indexOf("function ClassAnalysisPanel("), page.indexOf("function ClassAnalysisPanel(") + 12000);

test("a fold is open by default and shows its summary only when closed", () => {
  const fold = shared.slice(shared.indexOf("export function Collapsible("));
  assert.match(fold, /defaultOpen=true/);
  assert.match(fold, /<details className=\{"collapsible "\+className\} open=\{open\} onToggle=/, "a native <details>: keyboard and screen reader");
  assert.match(fold, /\{!open&&<span className="collapsible-summary cell-meta">\{summary\}<\/span>\}/);
});

test("every section folds: common errors, the DOK grid, Costa's levels, each standard", () => {
  for (const title of ['title="Most common error types across this assessment"', 'title="Depth of knowledge"', 'title="Costa\'s levels"'])
    assert.ok(panel.includes(title), title);
  assert.match(panel, /className="standard-card-body"\s*title=\{<h2>\{row\.standard\.title\}<\/h2>\}/);
  assert.match(panel, /row\.standard\.code \+\s*" · " \+/, "closed, a standard says its code, score, level and reteach call");
});

test("each level group under a standard is a drop-down that says how many it holds", () => {
  assert.match(panel, /<LevelStudents\s*collapsible/);
  const levels = shared.slice(shared.indexOf("export function LevelStudents("), shared.indexOf("export function Collapsible("));
  assert.match(levels, /summary=\{byLevel\[l\.level\]\.length\+\(byLevel\[l\.level\]\.length===1\?" student":" students"\)\}/);
  // Elsewhere (the writing panel, reports) the list stays as it was.
  assert.match(levels, /collapsible=false/);
});
