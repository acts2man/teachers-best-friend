import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

function bundle(path) {
  const result = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const shim = { exports: {} };
  new Function("module", "exports", result.outputFiles[0].text)(shim, shim.exports);
  return shim.exports;
}
const { fitWithin } = bundle("lib/image-prep.ts");

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

// Michael's class sets (6-7 Oct): the name pass read 22 names off 172 pages
// when it was shown only the top 18%. It now sees the top 45% -- and nothing is
// cut off the graded page, so the first question is never lost with the band.
const { nameAreaGeometry, NAME_AREA } = bundle("lib/image-prep.ts");
test("the name pass sees well over the old 18% band", () => {
  assert.ok(NAME_AREA >= 0.4);
  assert.equal(nameAreaGeometry(2000).height, Math.round(2000 * NAME_AREA));
  assert.equal(nameAreaGeometry(2000).top, 0);
});

test("no page is cut before it is graded, on any path", async () => {
  // The 18% name band cut questions off class-scan pages and the first lines
  // off essays. It is gone everywhere; the name pass reads a copy instead.
  const { readFileSync } = await import("node:fs");
  const prep = readFileSync("lib/image-prep.ts", "utf8");
  assert.ok(!/splitNameBand/.test(prep));
  const essays = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.ok(!/splitNameBand/.test(essays));
  assert.match(essays, /const file = await uprightPage\(incoming\[i\]\)/);
});
