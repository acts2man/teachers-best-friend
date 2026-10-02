// iOS camera fix, round 2 (after #102): the preview still wasn't filling the
// screen on iPhone (it rendered inside a page card, shutter/Done off-screen) and
// every shot was blurry. Two fixes, both tested here where the logic is pure or
// source-assertable:
//
//   1. Full-screen: the camera is rendered through a React portal into
//      document.body, so no transformed/clipping ancestor can box it in, and
//      page scroll is locked while it is open.
//   2. Sharper captures: each capture takes a short burst and keeps the sharpest
//      frame (variance of the Laplacian); below a blur threshold the frame is not
//      added silently -- a manual shot offers keep-anyway, an auto-snap is skipped.
//
// The sharpness maths (rgbaToGray, laplacianVariance, pickSharpest) are pure and
// tested directly. Whether a real iPhone now delivers a sharp, full-screen frame
// still needs a phone.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const require = createRequire(import.meta.url);
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    absWorkingDir: process.cwd(),
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

const { rgbaToGray, laplacianVariance, pickSharpest } = bundle("lib/camera.ts");

// ---------------------------------------------------------------
// rgbaToGray
// ---------------------------------------------------------------

test("rgbaToGray collapses RGBA to one luma channel", () => {
  const g = rgbaToGray([255, 255, 255, 255, 0, 0, 0, 255]);
  assert.equal(g.length, 2);
  assert.equal(g[0], 255, "white -> 255");
  assert.equal(g[1], 0, "black -> 0");
  // Pure green weighs more than pure blue (Rec.601 luma).
  const c = rgbaToGray([0, 255, 0, 255, 0, 0, 255, 255]);
  assert.ok(c[0] > c[1], "green is brighter than blue");
});

// ---------------------------------------------------------------
// laplacianVariance: high for sharp edges, zero for smooth
// ---------------------------------------------------------------

function checkerboard(w, h) {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) g[y * w + x] = (x + y) % 2 ? 255 : 0;
  return g;
}
function ramp(w, h) {
  // A smooth linear gradient in x: lots of brightness, but a zero Laplacian --
  // this is what an out-of-focus (blurry) frame looks like to the scorer.
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) g[y * w + x] = Math.round((x / (w - 1)) * 255);
  return g;
}
function flat(w, h, v = 128) {
  return new Uint8Array(w * h).fill(v);
}

test("laplacianVariance is high for a sharp (high-edge) image", () => {
  const v = laplacianVariance(checkerboard(16, 16), 16, 16);
  assert.ok(v > 100000, "a crisp checkerboard has a huge Laplacian variance: " + v);
});

test("laplacianVariance is ~0 for a flat image and a smooth gradient", () => {
  assert.equal(laplacianVariance(flat(16, 16), 16, 16), 0, "flat -> 0");
  // A linear ramp is perfectly smooth: no second-derivative energy.
  assert.ok(laplacianVariance(ramp(16, 16), 16, 16) < 1, "smooth gradient -> ~0");
});

test("a sharp frame scores far above a blurry one (the threshold has a gap to sit in)", () => {
  const sharp = laplacianVariance(checkerboard(24, 24), 24, 24);
  const blurry = laplacianVariance(ramp(24, 24), 24, 24);
  assert.ok(sharp > blurry * 1000, `sharp ${sharp} >> blurry ${blurry}`);
});

test("laplacianVariance is degenerate-safe on tiny images", () => {
  assert.equal(laplacianVariance(new Uint8Array(4), 2, 2), 0, "no interior pixels -> 0");
  assert.equal(laplacianVariance(new Uint8Array(0), 0, 0), 0, "empty -> 0");
});

// ---------------------------------------------------------------
// pickSharpest: the burst keeps the sharpest frame
// ---------------------------------------------------------------

test("pickSharpest returns the index of the highest score", () => {
  assert.equal(pickSharpest([1, 5, 3, 2]), 1);
  // Ties go to the first (stable).
  assert.equal(pickSharpest([5, 5, 1]), 0);
  assert.equal(pickSharpest([]), -1, "empty -> -1");
});

test("pickSharpest chooses the sharpest of a set of real frames", () => {
  const frames = [ramp(16, 16), flat(16, 16), checkerboard(16, 16)];
  const scores = frames.map((f) => laplacianVariance(f, 16, 16));
  assert.equal(pickSharpest(scores), 2, "the checkerboard is the sharpest frame");
});

// ---------------------------------------------------------------
// Component wiring (source assertions)
// ---------------------------------------------------------------

const src = readFileSync("components/scan-camera.tsx", "utf8");

test("the camera renders through a portal into document.body and locks scroll", () => {
  assert.match(src, /import \{ createPortal \} from "react-dom"/, "from react-dom");
  assert.match(src, /createPortal\(view, document\.body\)/, "portals the view into body");
  assert.match(src, /document\.body\.style\.overflow = "hidden"/, "locks page scroll while open");
});

test("capture takes a sharpest-of-burst frame", () => {
  assert.match(src, /BURST_FRAMES/, "a burst of frames");
  assert.match(src, /async function captureBurst\(/, "burst capture is its own function");
  assert.match(src, /laplacianVariance\(rgbaToGray\(/, "each frame is scored for sharpness");
  // Still cropped to exactly the visible cover region (#102).
  assert.match(src, /coverCrop\(fw, fh, vw, vh\)/, "capture still crops to the visible region");
  assert.match(src, /drawImage\(video, crop\.x, crop\.y, crop\.w, crop\.h/, "draws the cover crop");
});

test("a too-blurry frame is not added silently: keep-anyway (manual) or skip (auto)", () => {
  assert.match(src, /BLUR_THRESHOLD/, "there is a blur threshold");
  assert.match(src, /res\.score < BLUR_THRESHOLD/, "the best frame is checked against it");
  // Manual: offered as keep-anyway / try-again (not added until the teacher says so).
  assert.match(src, /setBlurryShot\(res\)/, "a blurry manual shot is held, not added");
  assert.match(src, /Keep anyway/, "keep-anyway affordance");
  assert.match(src, /Too blurry/, "a too-blurry message");
  // Auto: skipped with a hint, so it never buffers a blurry page on its own.
  assert.match(src, /if \(autoRef\.current\) flashBlurryHint\(\)/, "a blurry auto-snap is skipped");
});

test("the diagnostic panel reports the live and last-capture sharpness scores", () => {
  assert.match(src, /live sharpness:/);
  assert.match(src, /last capture score:/);
});
