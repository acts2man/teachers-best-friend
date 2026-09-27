// A wrong crop is worse than no crop. isConfidentQuad is the gate: only a quad
// that is large, convex, roughly rectangular, and whose top edge is near the
// top of the frame (so a crop can't slice off the name band) is trusted.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const { isConfidentQuad, isConvex } = bundle("lib/edge-detect.ts");

const W = 100;
const H = 100;
// A page filling most of a 100x100 frame, square to the edges, top near the top.
const good = [
  { x: 5, y: 5 },
  { x: 95, y: 5 },
  { x: 95, y: 95 },
  { x: 5, y: 95 },
];

test("a large, rectangular, top-anchored page is confident", () => {
  assert.equal(isConfidentQuad(good, W, H), true);
});

test("isConvex distinguishes a convex quad from a concave one", () => {
  assert.equal(isConvex(good), true);
  const concave = [{ x: 5, y: 5 }, { x: 95, y: 5 }, { x: 50, y: 40 }, { x: 5, y: 95 }];
  assert.equal(isConvex(concave), false);
});

test("a small quad is not confident (probably not a page)", () => {
  const small = [{ x: 30, y: 30 }, { x: 60, y: 30 }, { x: 60, y: 60 }, { x: 30, y: 60 }];
  assert.equal(isConfidentQuad(small, W, H), false); // ~9% of frame
});

test("a concave quad is not confident", () => {
  const concave = [{ x: 5, y: 5 }, { x: 95, y: 5 }, { x: 50, y: 40 }, { x: 5, y: 95 }];
  assert.equal(isConfidentQuad(concave, W, H), false);
});

test("opposite sides of very different length are not confident", () => {
  // A trapezoid: wide top, narrow bottom.
  const trap = [{ x: 5, y: 5 }, { x: 95, y: 5 }, { x: 70, y: 95 }, { x: 30, y: 95 }];
  assert.equal(isConfidentQuad(trap, W, H), false);
});

test("a page whose top edge is well below the frame top is NOT cropped (name band)", () => {
  // Large and rectangular, but its top sits at 40% down — cropping would risk
  // cutting the name above it, so it must fall back to the full frame.
  const lowTop = [{ x: 5, y: 40 }, { x: 95, y: 40 }, { x: 95, y: 98 }, { x: 5, y: 98 }];
  assert.equal(isConfidentQuad(lowTop, W, H), false);
});
