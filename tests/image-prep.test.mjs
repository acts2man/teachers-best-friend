import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

function bundle(path) {
  const result = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const shim = { exports: {} };
  new Function("module", "exports", result.outputFiles[0].text)(shim, shim.exports);
  return shim.exports;
}
const { fitWithin, bandGeometry, NAME_BAND } = bundle("lib/image-prep.ts");

test("fitWithin leaves a page that is already small enough alone", () => {
  assert.deepEqual(fitWithin(1200, 1600), { width: 1200, height: 1600 });
});

test("fitWithin caps the long edge and keeps the aspect ratio", () => {
  const out = fitWithin(4032, 3024, 2000);
  assert.equal(out.width, 2000);
  assert.equal(out.height, 1500);
  assert.ok(Math.abs(out.width / out.height - 4032 / 3024) < 0.01);
});

test("fitWithin caps a portrait page on its height", () => {
  const out = fitWithin(3024, 4032, 2000);
  assert.equal(out.height, 2000);
  assert.equal(out.width, 1500);
});

test("fitWithin never enlarges a small scan", () => {
  assert.deepEqual(fitWithin(300, 200, 2000), { width: 300, height: 200 });
});

test("fitWithin keeps at least one pixel on an extreme aspect ratio", () => {
  const out = fitWithin(10000, 3, 2000);
  assert.equal(out.width, 2000);
  assert.ok(out.height >= 1);
});

// The privacy guarantee: the name band and the graded body must not share a
// single row of pixels, or a name sitting on the boundary rides along with the
// answers into the grading request.
test("the name band and the body do not overlap", () => {
  for (const height of [100, 999, 1000, 1001, 1600, 2000, 3024]) {
    const { strip, body } = bandGeometry(height);
    assert.equal(strip.top, 0);
    assert.equal(body.top, strip.height, `overlap at height ${height}`);
    assert.equal(strip.height + body.height, height, `lost rows at height ${height}`);
  }
});

test("the name band takes the top of the page, not the bulk of it", () => {
  const { strip } = bandGeometry(1000);
  assert.equal(strip.height, Math.round(1000 * NAME_BAND));
  assert.ok(strip.height < 1000 / 2);
});

test("bandGeometry still yields a usable body on a very short page", () => {
  const { strip, body } = bandGeometry(3);
  assert.ok(strip.height >= 1);
  assert.ok(body.height >= 1);
  assert.equal(strip.height + body.height, 3);
});
