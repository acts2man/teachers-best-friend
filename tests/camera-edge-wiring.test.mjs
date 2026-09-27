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

test("it outlines the detected page and crops/straightens on capture", () => {
  assert.match(src, /findDocumentQuad\(/, "detects the page each frame");
  assert.match(src, /overlayCanvasRef/, "draws an on-screen outline");
  assert.match(src, /warpPerspective\(/, "crops and straightens on capture");
});

test("a missing OR low-confidence page still captures the full frame — never a wrong crop", () => {
  // The warp is gated on confidence; anything less keeps the plain frame.
  assert.match(src, /if \(edge && det && det\.confident\)/, "warp only when confidently a page");
  assert.match(src, /let out(:| )/, "a full-frame result is the default");
});

test("only a confident page crops and auto-snaps; low confidence shows a hint", () => {
  assert.match(src, /isConfidentQuad\(quad, dw, dh\)/, "confidence is computed each frame");
  // Auto-snap is fed the quad only when confident, else null (won't fire).
  assert.match(src, /autoSnapStep\([^;]*confident \? quad : null/, "auto-snap gated on confidence");
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
  // Auto-snap only fires when Auto is on.
  assert.match(src, /if \(autoRef\.current &&[\s\S]*r\.fire\) shootRef\.current\(\)/);
});

test("detection runs on a downscaled buffer and is throttled to stay light", () => {
  assert.match(src, /DETECT_W\s*=\s*\d+/, "a small working width");
  assert.match(src, /DETECT_EVERY_MS/, "throttled, not every frame");
});
