// Camera blur check (Ricky, 29 Oct 2026: "3-4 blurry photos of 66 ... catch
// when the photo is blurry and ask to retake or keep"). Proven when, on the
// camera browser check's page images blurred by known amounts and scored the
// way the camera scores a capture (scripts/tune-blur-threshold.mjs):
//   - every page out of focus at sigma >= 3 px, and the far or sparse page at
//     sigma >= 2, counts as blurry -- the old Laplacian cut of 55 let most of
//     these through;
//   - every page at sigma <= 1.5, and the sharp pages, are kept;
// a blurry capture asks Retake / Keep on the phone (no upload, no AI); and the
// first open shows "Best results: stand and hold the phone over the page."
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const C = bundle("lib/camera.ts");
const rows = JSON.parse(execFileSync("node", ["scripts/tune-blur-threshold.mjs"], { encoding: "utf8", maxBuffer: 1 << 20 }));
const verdict = (r) => C.isBlurry({ laplacian: r.score[0], reblur: r.score[2] });
const sigma = (r) => Number((r.blur.match(/σ=([\d.]+)/) || [])[1] ?? NaN);

test("the tuned rule: unreadable focus blur is caught, readable pages are kept", () => {
  for (const r of rows.filter((x) => x.blur.startsWith("focus"))) {
    const s = sigma(r);
    if (s >= 3) assert.ok(verdict(r), `${r.page} ${r.blur} is blurry (${r.score})`);
    if (s <= 1.5) assert.ok(!verdict(r), `${r.page} ${r.blur} is kept (${r.score})`);
  }
  for (const page of ["far (camera-controls)", "close (camera-controls)"]) {
    const r = rows.find((x) => x.page === page && x.blur === "focus σ=2px");
    assert.ok(verdict(r), `${page} at σ=2 is blurry (${r.score})`);
  }
  assert.equal(C.BLUR_LAPLACIAN_MIN, 150);
  assert.equal(C.BLUR_REBLUR_MIN, 25);
});

test("the old cut (Laplacian 55 alone) let unreadable photos through", () => {
  const missed = rows.filter((r) => r.blur.startsWith("focus") && sigma(r) >= 2 && r.score[0] >= 55 && verdict(r));
  assert.ok(missed.length >= 4, `photos the old cut kept and the new rule catches: ${missed.map((r) => r.page + " " + r.blur).join("; ")}`);
});

test("the re-blur ratio ignores how much is written on the page", () => {
  const sharp = rows.filter((r) => r.blur === "focus σ=0px").map((r) => r.score[2]);
  assert.ok(Math.min(...sharp) >= 50, "every sharp page, sparse or written, scores high: " + sharp);
  const lap = rows.filter((r) => r.blur === "focus σ=0px").map((r) => r.score[0]);
  assert.ok(Math.max(...lap) / Math.min(...lap) > 2, "where the Laplacian alone swings with the content: " + lap);
  assert.equal(C.reblurRatio(new Array(100).fill(128), 10, 10), 0, "a flat frame is all blur");
});

test("a blurry capture asks Retake / Keep on the phone; the first open shows the tip", () => {
  const src = readFileSync("components/scan-camera.tsx", "utf8");
  const capture = src.slice(src.indexOf("async function captureNow("), src.indexOf("function shoot()"));
  assert.match(capture, /\/\/ Checked right after the capture, on the phone: no upload, no AI\./);
  assert.doesNotMatch(capture.replace(/\/\/[^\n]*/g, ""), /fetch\(|analyze|upload/i, "no request at all");
  assert.match(src, /<h2>This photo looks blurry<\/h2>/);
  assert.match(src, /Best results: stand and hold the phone over the page\./);
  assert.match(src, /const CAMERA_TIP_KEY = "tbf\.camera\.tip-seen";/);
  assert.match(src, /\{tip && !starting && shots\.length === 0 && \(/, "until the first photo, or dismissed");
});
