// The DOK grid at 360px (Michael's phone size class): with every cell
// Exceeding, "Extension Recommended" ran out of its cell -- a phone's cell is
// about 60px wide inside and "Recommended" is one word wider than that. On a
// phone (below 700px) the cell now shows the short form ("Reteach",
// "Extension"); the full recommendation stays the cell's title and spoken
// label, and a computer still shows it in full. The browser check
// (scripts/browser-check/dok-grid.mjs) proves nothing clips at 360, 390, 412
// and computer size.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";

const r = buildSync({ entryPoints: ["components/dok-grid.tsx"], bundle: true, platform: "node", format: "cjs", write: false, external: ["react", "react/jsx-runtime"], jsx: "automatic" });
const m = { exports: {} };
new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, (id) => (id.startsWith("react") ? {} : null));
const { shortAdvice } = m.exports;

test("the short recommendations", () => {
  assert.equal(shortAdvice("Reteach Recommended"), "Reteach");
  assert.equal(shortAdvice("Extension Recommended"), "Extension");
  assert.equal(shortAdvice("Monitor"), "Monitor");
  assert.equal(shortAdvice("Ready to Move On"), "Ready to Move On", "wraps on whole words, so it stays");
});

test("a cell carries both; a phone shows the short one, a computer the full one", () => {
  const grid = readFileSync("components/dok-grid.tsx", "utf8");
  assert.match(grid, /<span className="dok-cell-advice" title=\{cell\.level\.advice\}>\s+<span className="advice-full">\{cell\.level\.advice\}<\/span>\s+<span className="advice-short">\{shortAdvice\(cell\.level\.advice\)\}<\/span>/);
  assert.match(grid, /aria-label=\{`\$\{code\}, DOK \$\{cell\.dok\}: \$\{cell\.percent\}%, \$\{cell\.level\.level\}, \$\{cell\.level\.advice\}/, "the spoken label keeps the full recommendation");
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /\.dok-cell-advice \.advice-short\{display:none\}/);
  const phone = /@media\(max-width:699px\)\{\.dok-grid-head\{display:none\}[^\n]*/.exec(css)?.[0] ?? "";
  assert.match(phone, /\.dok-cell-advice \.advice-full\{display:none\}\.dok-cell-advice \.advice-short\{display:inline\}/);
});
