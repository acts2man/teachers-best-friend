// PR1: what the camera shows must match what it saves.
//
// Michael (Android/Brave) framed a page to the preview and the saved photo had
// the whole desk around it: the preview was `object-fit: cover` (cropped the
// wider frame to the tall screen) while the capture kept the full frame. The fix
// shows the full frame (`contain`) so preview == capture, requests a portrait
// frame when the phone is upright, and asks for continuous + tap-to-focus. This
// also re-locks that auto-snap only ever fires on a confident, steady page.
//
// NOTE: the real-device behaviour (does Brave honour the portrait request? does
// the lens actually focus?) cannot be checked here. These tests cover the code
// that is deterministic: the constraints requested, the CSS, the wiring, and the
// auto-snap decision logic.
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
// Stream constraints: portrait when upright, continuous focus always
// ---------------------------------------------------------------

test("an upright phone asks for a portrait frame", () => {
  const p = videoConstraints("environment", true);
  assert.ok(
    p.video.height.ideal > p.video.width.ideal,
    "portrait: taller than wide so a portrait page fills the frame",
  );
  const l = videoConstraints("environment", false);
  assert.ok(l.video.width.ideal >= l.video.height.ideal, "default stays landscape-ish");
});

test("continuous autofocus is requested in the constraints", () => {
  const c = videoConstraints();
  const focus = (c.video.advanced || []).some((a) => a.focusMode === "continuous");
  assert.ok(focus, "advanced constraints ask for continuous focus");
});

// ---------------------------------------------------------------
// The preview shows the whole frame (contain), matching the capture
// ---------------------------------------------------------------

test("the camera video and overlay are contain, not cover", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const video = /\.scan-camera-video\{[^}]*\}/.exec(css)[0];
  const overlay = /\.scan-camera-overlay\{[^}]*\}/.exec(css)[0];
  assert.match(video, /object-fit:contain/);
  assert.doesNotMatch(video, /object-fit:cover/);
  assert.match(overlay, /object-fit:contain/);
  assert.doesNotMatch(overlay, /object-fit:cover/);
});

// ---------------------------------------------------------------
// Component wiring: portrait detection, focus, tap-to-focus
// ---------------------------------------------------------------

test("the camera requests portrait when upright and applies focus to the live track", () => {
  const src = readFileSync("components/scan-camera.tsx", "utf8");
  assert.match(src, /window\.innerHeight >= window\.innerWidth/);
  assert.match(src, /videoConstraints\("environment", portrait\)/);
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
