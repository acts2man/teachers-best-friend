// iOS camera fix (after #96): the preview fills the screen like the native
// camera, and each capture is cropped to exactly the visible region so what the
// teacher sees is what gets saved -- on a landscape frame (iOS Safari hands one
// back even when the phone is upright) and a portrait frame (Android) alike.
//
// The geometry is pure and tested here: coverCrop maps the visible cover region
// back to frame pixels, and coverMapPoint maps a frame point onto the on-screen
// cover preview (used to draw the edge outline). The real-device behaviour
// (does iOS actually deliver a sharp frame, does focus work) still needs a phone.
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

const { coverCrop, coverMapPoint, videoConstraints } = bundle("lib/camera.ts");

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.5, `${msg}: ${a} vs ${b}`);

// ---------------------------------------------------------------
// coverCrop: the visible region in frame pixels
// ---------------------------------------------------------------

test("a landscape frame on a portrait screen crops to a centered portrait strip", () => {
  // iOS: phone upright, but the frame comes back 1920x1080.
  const c = coverCrop(1920, 1080, 390, 844);
  close(c.h, 1080, "full height is visible");
  close(c.w, (1080 * 390) / 844, "width is the screen's aspect");
  close(c.x, (1920 - c.w) / 2, "centered horizontally");
  close(c.y, 0, "no vertical crop");
  // The crop has the screen's aspect ratio (what you see).
  close(c.w / c.h, 390 / 844, "crop matches screen aspect");
});

test("a portrait frame on a portrait screen crops to a centered portrait region", () => {
  // Android: frame comes back 1080x1920.
  const c = coverCrop(1080, 1920, 390, 844);
  close(c.h, 1920, "full height visible");
  close(c.w, (1920 * 390) / 844, "width is the screen's aspect");
  close(c.w / c.h, 390 / 844, "crop matches screen aspect");
});

test("coverCrop never exceeds the frame and is degenerate-safe", () => {
  const c = coverCrop(1920, 1080, 390, 844);
  assert.ok(c.x >= 0 && c.y >= 0 && c.w <= 1920 && c.h <= 1080);
  // Zero inputs don't throw or produce NaN.
  const z = coverCrop(0, 0, 390, 844);
  assert.ok(Number.isFinite(z.w) && Number.isFinite(z.h));
});

// ---------------------------------------------------------------
// coverMapPoint: a frame point onto the on-screen cover preview
// ---------------------------------------------------------------

test("the frame center maps to the screen center under cover", () => {
  const p = coverMapPoint(960, 540, 1920, 1080, 390, 844);
  close(p.x, 195, "center x");
  close(p.y, 422, "center y");
});

test("the visible crop's corners map to the screen's corners", () => {
  const fw = 1920, fh = 1080, vw = 390, vh = 844;
  const c = coverCrop(fw, fh, vw, vh);
  const tl = coverMapPoint(c.x, c.y, fw, fh, vw, vh);
  const br = coverMapPoint(c.x + c.w, c.y + c.h, fw, fh, vw, vh);
  close(tl.x, 0, "crop top-left -> screen left");
  close(tl.y, 0, "crop top-left -> screen top");
  close(br.x, vw, "crop bottom-right -> screen right");
  close(br.y, vh, "crop bottom-right -> screen bottom");
});

test("coverCrop and coverMapPoint agree for a portrait frame too", () => {
  const fw = 1080, fh = 1920, vw = 390, vh = 844;
  const c = coverCrop(fw, fh, vw, vh);
  const tl = coverMapPoint(c.x, c.y, fw, fh, vw, vh);
  const br = coverMapPoint(c.x + c.w, c.y + c.h, fw, fh, vw, vh);
  close(tl.x, 0, "tl x");
  close(br.x, vw, "br x");
  close(br.y, vh, "br y");
});

// ---------------------------------------------------------------
// Constraints are not over-forced (iOS)
// ---------------------------------------------------------------

test("constraints ask for the rear camera and a resolution hint only, no orientation forcing", () => {
  const c = videoConstraints();
  assert.equal(c.video.facingMode.ideal, "environment");
  // A square ideal does not bias portrait vs landscape, and there is no
  // aspectRatio to make Safari pick a landscape mode.
  assert.equal(c.video.width.ideal, c.video.height.ideal);
  assert.equal(c.video.aspectRatio, undefined);
  assert.ok((c.video.advanced || []).some((a) => a.focusMode === "continuous"));
});

// ---------------------------------------------------------------
// The component wires it up
// ---------------------------------------------------------------

const src = readFileSync("components/scan-camera.tsx", "utf8");

test("the preview fills the screen and the capture crops to the visible region", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const video = /\.scan-camera-video\{[^}]*\}/.exec(css)[0];
  assert.match(video, /object-fit:cover/);
  // Capture uses coverCrop against the live video + on-screen size; no full-frame
  // draw and no perspective warp.
  assert.match(src, /coverCrop\(fw, fh, vw, vh\)/);
  assert.match(src, /drawImage\(video, crop\.x, crop\.y, crop\.w, crop\.h/);
  assert.doesNotMatch(src, /warpPerspective/);
});

test("the outline is mapped into the cover preview space", () => {
  assert.match(src, /coverMapPoint\(p\.x, p\.y, dw, dh, vw, vh\)/);
});

test("orientation is read from the live video dimensions at capture time", () => {
  assert.match(src, /const fw = video\.videoWidth/);
  assert.match(src, /video\.clientWidth \|\| window\.innerWidth/);
});

test("capture waits for the stream to settle, and auto-snap is gated on it", () => {
  assert.match(src, /if \(!settledRef\.current\) return;/);
  assert.match(src, /autoRef\.current && settledRef\.current/);
  assert.match(src, /disabled=\{starting \|\| finishing \|\| !settled \|\| atCap\}/);
});

test("a hidden diagnostic panel reports the frame, track settings, orientation and capture size", () => {
  assert.match(src, /function diagnostics\(\)/);
  assert.match(src, /aria-label="Camera diagnostics"/);
  assert.match(src, /video frame:/);
  assert.match(src, /track focusMode:/);
  assert.match(src, /last capture:/);
});
