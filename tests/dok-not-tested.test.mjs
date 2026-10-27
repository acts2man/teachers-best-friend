// Ricky (26 Oct 2026): a DOK-grid box with no questions says "Not Tested",
// not "No questions", and tapping it says why there is no score: no question
// on this test was at that DOK level for that standard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const grid = readFileSync("components/dok-grid.tsx", "utf8");
const panel = readFileSync("components/dok-cell-panel.tsx", "utf8");

test("an empty box and the legend say Not Tested", () => {
  assert.match(grid, /<span className="dok-cell-empty">Not Tested<\/span>/);
  assert.match(grid, /<span className="level-none">Not Tested<\/span>/);
  assert.doesNotMatch(grid, /No questions/);
});

test("an empty box is a button that opens its explanation", () => {
  const empty = grid.slice(grid.indexOf("if (!cell.questions)"), grid.indexOf("if (cell.percent === null"));
  assert.match(empty, /role="button"/);
  assert.match(empty, /onClick=\{onOpen\}/);
  assert.match(empty, /aria-label=\{`\$\{code\}, DOK \$\{cell\.dok\}: not tested`\}/);
  assert.match(grid, /opened && !opened\.cell\.questions && \(\s*<NotTestedPanel/);
});

test("the explanation says no question on this test was at that DOK level", () => {
  assert.match(panel, /export function NotTestedPanel/);
  assert.match(panel, /No questions on this test were at DOK \{cell\.dok\}/);
  assert.match(panel, /\{standard\.code\} · DOK \{cell\.dok\} · Not Tested/);
});
