// PR1: what the camera shows must match what it saves.
//
// Michael (Android/Brave) framed a page to the preview and the saved photo had
// the whole desk around it: the preview was `object-fit: cover` (cropped the
// wider frame to the tall screen) while the capture kept the full frame. The
// original fix showed the full frame (`contain`). But on iOS Safari (Ricky)
// `contain` + a portrait request letterboxed the landscape frame iOS actually
// delivered into a thin strip. The current fix (see tests/camera-ios-cover.test.mjs)
// goes back to `cover` and crops every capture to exactly the visible region, so
// preview == capture on both platforms without forcing an orientation.
//
// This file keeps the parts of Michael's fix that still hold: continuous +
// tap-to-focus, and that auto-snap only ever fires on a confident, steady page.
// The CSS/constraints/crop geometry live in tests/camera-ios-cover.test.mjs.
//
// NOTE: the real-device behaviour (does Brave/Safari actually focus?) cannot be
// checked here. These tests cover the deterministic code: the focus wiring and
// the auto-snap decision logic.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";
import path from "node:path";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

const { videoConstraints } = bundle("lib/camera.ts");
const { autoSnapStep, initialAutoSnapState, AUTO_SNAP_DEFAULTS } = bundle("lib/auto-snap.ts");

// ---------------------------------------------------------------
// Stream constraints: continuous focus always (orientation is NOT
// forced any more -- see tests/camera-ios-cover.test.mjs)
// ---------------------------------------------------------------

test("continuous autofocus is requested in the constraints", () => {
  const c = videoConstraints();
  const focus = (c.video.advanced || []).some((a) => a.focusMode === "continuous");
  assert.ok(focus, "advanced constraints ask for continuous focus");
});

// ---------------------------------------------------------------
// Component wiring: focus and tap-to-focus
// ---------------------------------------------------------------

test("the camera applies continuous focus to the live track and wires tap-to-focus", () => {
  const src = readFileSync("components/scan-camera.tsx", "utf8");
  assert.match(src, /applyContinuousFocus\(stream\)/);
  // Tap-to-focus is wired to the preview and uses a point of interest.
  assert.match(src, /onClick=\{tapToFocus\}/);
  assert.match(src, /pointsOfInterest/);
});

// ---------------------------------------------------------------
// Auto-snap only fires on a confident, steady page
// ---------------------------------------------------------------

test("auto-snap never fires without a page in view", () => {
  // The component feeds `quad: null` whenever detection is not confident, so a
  // desk with no page can never auto-capture.
  let s = initialAutoSnapState;
  for (let t = 0; t < 5000; t += 120) {
    const r = autoSnapStep(s, { quad: null, now: t }, AUTO_SNAP_DEFAULTS);
    s = r.state;
    assert.equal(r.fire, false, "no quad -> never fires");
  }
});

test("auto-snap fires only after a confident page is held steady, then cools down", () => {
  const quad = [
    { x: 10, y: 10 },
    { x: 300, y: 12 },
    { x: 298, y: 400 },
    { x: 12, y: 402 },
  ];
  let s = initialAutoSnapState;
  let fired = 0;
  let firstFireAt = null;
  for (let t = 0; t <= AUTO_SNAP_DEFAULTS.holdMs + 240; t += 120) {
    const r = autoSnapStep(s, { quad, now: t }, AUTO_SNAP_DEFAULTS);
    s = r.state;
    if (r.fire) {
      fired++;
      if (firstFireAt === null) firstFireAt = t;
    }
  }
  assert.equal(fired, 1, "exactly one fire while the same page is held steady");
  assert.ok(firstFireAt >= AUTO_SNAP_DEFAULTS.holdMs, "not before the hold elapsed");
});

test("the component gates auto-snap on confidence", () => {
  const src = readFileSync("components/scan-camera.tsx", "utf8");
  assert.match(src, /confident \? quad : null/);
});
