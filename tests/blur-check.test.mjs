// Camera blur check (Ricky, 29 Oct 2026: "3-4 blurry photos of 66 ... catch
// when the photo is blurry and ask to retake or keep"). Proven when, on the
// camera browser check's page images blurred by known amounts and scored the
// way the camera scores a capture (scripts/tune-blur-threshold.mjs):
//   - every page out of focus at sigma >= 3 px, and the far, sparse page at
//     sigma 2, counts as blurry -- the old Laplacian cut of 55 let most of
//     these through;
//   - every page at sigma <= 1.5, and the sharp pages, are kept;
//   - since the review of #200, BOTH measures must say blurry, the thresholds
//     are re-tuned on realistic pages (light pencil, grey worksheets, sensor
//     noise, JPEG: scripts/tune-blur-realistic.mjs), and auto-capture keeps
//     its own cutoff of 55;
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
  // sigma 2 is the edge of readable: the far, sparse page is caught there.
  const far = rows.find((x) => x.page === "far (camera-controls)" && x.blur === "focus σ=2px");
  assert.ok(verdict(far), `far page at σ=2 is blurry (${far.score})`);
  assert.equal(C.BLUR_LAPLACIAN_MIN, 145);
  assert.equal(C.BLUR_REBLUR_MIN, 30);
});

test("both measures must agree (review of #200): either one alone never questions a photo", () => {
  assert.equal(C.isBlurry({ laplacian: 100, reblur: 20 }), true, "both say blurry");
  assert.equal(C.isBlurry({ laplacian: 100, reblur: 45 }), false, "a sparse page: the Laplacian is low, the re-blur ratio says sharp");
  assert.equal(C.isBlurry({ laplacian: 900, reblur: 20 }), false, "a busy page the re-blur ratio doubts, the Laplacian says sharp");
});

test("the old cut (Laplacian 55 alone) let unreadable photos through", () => {
  const missed = rows.filter((r) => r.blur.startsWith("focus") && sigma(r) >= 2 && r.score[0] >= 55 && verdict(r));
  assert.ok(missed.length >= 3, `photos the old cut kept and the new rule catches: ${missed.map((r) => r.page + " " + r.blur).join("; ")}`);
});

test("auto-capture keeps its own cutoff (55), apart from the Retake/Keep check", () => {
  assert.equal(C.AUTO_CAPTURE_MIN_SHARPNESS, 55);
  const src = readFileSync("components/scan-camera.tsx", "utf8");
  assert.match(src, /const BLUR_THRESHOLD = AUTO_CAPTURE_MIN_SHARPNESS;/);
  assert.doesNotMatch(src, /const BLUR_THRESHOLD = BLUR_LAPLACIAN_MIN;/);
  assert.match(src, /if \(isBlurry\(\{ laplacian: res\.score, reblur: res\.reblur \}\)\)/, "Retake/Keep asks with both measures");
});

test("realistic pages: pencil, grey worksheets, sensor noise and JPEG -- no sharp page questioned", async () => {
  // A slice of scripts/tune-blur-realistic.mjs (the whole run takes ~40 s):
  // one seed, a clean and a poor-light photo of each page.
  const { measure } = await import("../scripts/tune-blur-realistic.mjs");
  const all = await measure({ seeds: [1], noises: [0, 6] });
  const sharp = all.filter((r) => r.sigma <= 1.5);
  const blurry = all.filter((r) => r.sigma >= 3);
  const flaggedSharp = sharp.filter((r) => C.isBlurry(r));
  assert.deepEqual(flaggedSharp, [], "a sharp page is never questioned");
  // With margin: still none at 15% more Laplacian and 3 points more re-blur.
  assert.ok(!sharp.some((r) => r.laplacian < C.BLUR_LAPLACIAN_MIN * 1.15 && r.reblur < C.BLUR_REBLUR_MIN + 3), "with room to spare");
  // Every page out of focus is caught in good light, pencil and grey paper
  // included. In poor light the sensor noise hides the blur from both
  // measures -- the honest limit; on the whole run (three noise levels,
  // three seeds) 72 of 108 out-of-focus photos are caught.
  const clean = blurry.filter((r) => r.noise === 0);
  const missedClean = clean.filter((r) => !C.isBlurry(r)).map((r) => r.page + " σ" + r.sigma);
  assert.deepEqual(missedClean, [], "every clean out-of-focus photo is caught");
  const caught = blurry.filter((r) => C.isBlurry(r)).length;
  assert.ok(caught / blurry.length >= 0.5, `out-of-focus pages caught: ${caught}/${blurry.length}`);
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
