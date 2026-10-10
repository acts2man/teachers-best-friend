// The edge-detection / auto-snap wiring in the camera component (source
// assertions, like the other component tests). The behaviour itself is covered
// by tests/edge-detect.test.mjs and tests/auto-snap.test.mjs; here we pin that
// the component actually uses it the way the feature requires.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("components/scan-camera.tsx", "utf8");

test("detection code is loaded lazily, only when the camera opens", () => {
  assert.match(src, /import\("@\/lib\/edge-detect"\)/, "edge-detect is dynamically imported");
  assert.match(src, /import\("@\/lib\/auto-snap"\)/, "auto-snap is dynamically imported");
  // Not statically imported (which would bundle it into the main chunk).
  assert.ok(!/^import .*from "@\/lib\/edge-detect"/m.test(src), "edge-detect not statically imported");
});

test("it outlines the detected page; capture crops to the visible region, not a warp", () => {
  assert.match(src, /findDocumentQuad\(/, "detects the page each frame");
  assert.match(src, /overlayCanvasRef/, "draws an on-screen outline");
  // Capture is now exactly what the cover preview shows (coverCrop), so the saved
  // photo matches the screen on every device. The perspective warp is gone -- it
  // produced a different image than the preview and depended on a quad that iOS
  // was mapping to the wrong place.
  assert.match(src, /coverCrop\(fw, fh, vw, vh\)/, "capture crops to the visible region");
  assert.doesNotMatch(src, /warpPerspective\(/, "no perspective warp on capture");
});

test("every capture crops to exactly the visible region, regardless of the detected quad", () => {
  // No confidence branch in the capture path any more: the crop is the visible
  // cover region, so the outline can never cause a wrong crop.
  assert.match(src, /drawImage\(video, crop\.x, crop\.y, crop\.w, crop\.h/, "draws the cover crop");
  assert.doesNotMatch(src, /if \(edge && det && det\.confident\)/, "capture does not branch on the quad");
});

test("only a confident, sharp page auto-snaps; low confidence shows a hint", () => {
  assert.match(src, /isConfidentQuad\(quad, dw, dh\)/, "confidence is computed each frame");
  // Auto-snap is fed the quad only when confident AND sharp, else null (won't
  // fire): a blurry or out-of-focus frame never auto-captures.
  assert.match(src, /confident && sharp \? quad : null/, "auto-snap gated on confidence + sharpness");
  assert.match(src, /Hold steady or tap the shutter/, "low-confidence hint text");
  assert.match(src, /auto && lowConfidence/, "the hint shows only in Auto when unsure");
});

test("Auto/Manual is a toggle, remembered per teacher", () => {
  assert.match(src, /localStorage\.getItem\(AUTO_KEY\)/, "reads the saved choice");
  assert.match(src, /localStorage\.setItem\(AUTO_KEY/, "saves the choice");
  assert.match(src, /toggleAuto/, "there is a toggle");
  assert.match(src, /aria-pressed=\{auto\}/, "the toggle reflects state");
});

test("the manual shutter works in both modes and auto-snap is gated on Auto", () => {
  // The shutter button always calls shoot and is never disabled by `auto`.
  assert.match(src, /className="scan-camera-shutter"[\s\S]*onClick=\{shoot\}/);
  assert.ok(
    !/scan-camera-shutter[\s\S]*disabled=\{[^}]*\bauto\b/.test(src),
    "the shutter is not disabled in manual mode",
  );
  // Auto-snap only fires when Auto is on, and never past the batch page cap.
  assert.match(src, /if \(autoRef\.current && settledRef\.current/);
  assert.match(src, /if \(r\.fire && !atCapRef\.current\) shootRef\.current\(\)/);
});

test("detection runs on a downscaled buffer and is throttled to stay light", () => {
  assert.match(src, /DETECT_W\s*=\s*\d+/, "a small working width");
  assert.match(src, /DETECT_EVERY_MS/, "throttled, not every frame");
});
