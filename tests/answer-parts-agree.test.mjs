// #125 follow-up d: expectedParts(2.7) was 1 but clampParts(2.7) was 2, so the
// count shown in the editor and the count grading used could differ. The
// database decides what is kept -- sync_workspace stores
// nullif(least(greatest(coalesce(safe_int(v), 1), 1), 20), 1), and
// safe_int('2.7') is NULL -- so both functions now follow it: a value that is
// not a whole number of at least 2 is one answer.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const r = buildSync({ entryPoints: ["lib/answer-parts.ts"], bundle: true, platform: "node", format: "cjs", write: false });
const m = { exports: {} };
new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
const { expectedParts, clampParts } = m.exports;

/** What sync_workspace stores for a JSON value (null = one answer). */
function stored(v) {
  const text = v === null || v === undefined ? null : String(v);
  const n = text !== null && /^\s*[+-]?\d+\s*$/.test(text) ? parseInt(text, 10) : null; // safe_int
  const kept = Math.min(Math.max(n ?? 1, 1), 20);
  return kept === 1 ? null : kept;
}

test("expectedParts, clampParts and the database agree on every value", () => {
  for (const v of [undefined, null, 0, 1, 2, 2.7, 3, 3.0, 4.5, 19, 20, 21, 25, -3, "abc", "4", NaN, Infinity]) {
    const db = stored(typeof v === "number" && !Number.isFinite(v) ? "x" : v) ?? 1;
    assert.equal(expectedParts({ answerParts: v }), db, `expectedParts(${v})`);
    assert.equal(clampParts(v) ?? 1, db, `clampParts(${v})`);
  }
});
