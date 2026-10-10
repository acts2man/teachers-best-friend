// "Check what each question measures" table overlap (Michael, Windows desktop):
// the shared Table cell is whitespace-nowrap, so on a desktop -- where the table
// fits instead of scrolling -- a long question ran into the Skill & standard
// column and a long standard code overlapped the question. The desktop fix lets
// the cells wrap and caps the two text columns. A browser check
// (scripts/browser-check/report-table-desktop.mjs) proves the pixels; this is
// the tripwire that the rule does not silently revert.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("app/globals.css", "utf8");

test("the desktop report table lets long question and standard text wrap", () => {
  // Scoped to desktop: the phone keeps its scrolling layout untouched.
  assert.match(css, /@media\(min-width:768px\)\{[\s\S]*\.report-table td,\.report-table th\{white-space:normal/);
  assert.match(css, /\.report-table \.cell-meta\{overflow-wrap:anywhere;word-break:break-word\}/);
});

test("the two text columns are capped so neither crowds the other", () => {
  assert.match(css, /\.report-table td:first-child\{max-width:360px\}/);
  assert.match(css, /\.report-table td:nth-child\(2\)\{max-width:240px\}/);
});
