// Page-edge detection and perspective correction — the pure math, tested
// without a canvas. The live detector is best-effort (it returns null when
// unsure and the camera then keeps the full frame), but corner ordering, the
// homography solve, and the warp must be exact.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({
    entryPoints: [path],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const {
  orderCorners,
  quadArea,
  solveHomography,
  applyHomography,
  warpPerspective,
  findDocumentQuad,
  quadDrift,
} = bundle("lib/edge-detect.ts");

test("orderCorners returns tl, tr, br, bl regardless of input order", () => {
  const scrambled = [
    { x: 10, y: 10 }, // br
    { x: 0, y: 10 }, // bl
    { x: 0, y: 0 }, // tl
    { x: 10, y: 0 }, // tr
  ];
  assert.deepEqual(orderCorners(scrambled), [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]);
});

test("quadArea is the shoelace area", () => {
  assert.equal(quadArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]), 100);
});

test("the homography maps each source corner onto its target", () => {
  const from = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  // A trapezoid — a real perspective, not just a scale.
  const to = [{ x: 12, y: 8 }, { x: 88, y: 20 }, { x: 95, y: 92 }, { x: 5, y: 80 }];
  const h = solveHomography(from, to);
  assert.ok(h, "solvable");
  for (let i = 0; i < 4; i++) {
    const p = applyHomography(h, from[i]);
    assert.ok(Math.abs(p.x - to[i].x) < 1e-6 && Math.abs(p.y - to[i].y) < 1e-6, "corner " + i);
  }
});

test("degenerate correspondences return null instead of NaNs", () => {
  const same = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
  assert.equal(solveHomography(same, same), null);
});

test("an identity warp reproduces the source pixels", () => {
  const w = 8;
  const h = 8;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = x * 10 + y; // distinct value per pixel
      data[i + 3] = 255;
    }
  const quad = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const out = warpPerspective({ data, width: w, height: h }, quad, { width: w, height: h });
  for (const [x, y] of [[0, 0], [3, 5], [7, 7]]) {
    assert.equal(out.data[(y * w + x) * 4], x * 10 + y, `pixel ${x},${y}`);
  }
});

// A synthetic RGBA with a bright rectangle on a dark background.
function rectImage(size, x0, y0, x1, y1) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const v = x >= x0 && x < x1 && y >= y0 && y < y1 ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  return { data, width: size, height: size };
}

test("findDocumentQuad finds a page-sized rectangle's corners", () => {
  const quad = findDocumentQuad(rectImage(60, 10, 10, 50, 50));
  assert.ok(quad, "a large rectangle is detected");
  const near = (p, x, y) => Math.abs(p.x - x) <= 6 && Math.abs(p.y - y) <= 6;
  assert.ok(near(quad[0], 10, 10), "tl");
  assert.ok(near(quad[1], 50, 10), "tr");
  assert.ok(near(quad[2], 50, 50), "br");
  assert.ok(near(quad[3], 10, 50), "bl");
});

test("findDocumentQuad returns null when there is no page (full-frame fallback)", () => {
  // Flat image: no edges.
  assert.equal(findDocumentQuad(rectImage(60, 0, 0, 0, 0)), null);
  // A speck far too small to be a page.
  assert.equal(findDocumentQuad(rectImage(60, 28, 28, 32, 32)), null);
});

test("quadDrift measures the largest corner movement, ∞ when a quad is missing", () => {
  const a = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const b = [{ x: 3, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(quadDrift(a, b), 3);
  assert.equal(quadDrift(a, null), Infinity);
});
