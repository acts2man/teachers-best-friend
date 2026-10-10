// Ricky scans a whole class in one go -- 36 students at up to 5 pages each --
// so the per-batch page cap went from 80 to 180. The in-app camera now says
// when the cap is reached instead of letting a teacher scan on and be turned
// away at the end. These guard the number, that the class scan hands the camera
// its remaining budget, and that the camera blocks the shutter and auto-snap at
// the cap.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scan = readFileSync("components/teacher-class-scan.tsx", "utf8");
const camera = readFileSync("components/scan-camera.tsx", "utf8");

test("the class-scan page cap is 180", () => {
  assert.match(scan, /const MAX_PAGES = 180;/);
});

test("the class scan hands the camera how many pages are left in the batch", () => {
  assert.match(scan, /budget=\{Math\.max\(0, MAX_PAGES - captured\.length\)\}/);
});

test("the camera takes a budget and derives whether it is at the cap", () => {
  assert.match(camera, /budget\?: number/, "budget is an optional prop (no cap for single scans)");
  assert.match(camera, /const atCap = budget != null && shots\.length >= budget;/);
});

test("at the cap the camera takes nothing more -- both shutter and auto-snap are blocked", () => {
  // The single capture funnel bails at the cap...
  assert.match(camera, /if \(atCapRef\.current\) return;/, "captureNow bails at the cap");
  // ...and auto-snap does not fire either.
  assert.match(camera, /if \(r\.fire && !atCapRef\.current\) shootRef\.current\(\);/);
  // The shutter is disabled.
  assert.match(camera, /disabled=\{starting \|\| finishing \|\| !settled \|\| atCap\}/);
});

test("the camera shows a clear 'reached the limit' banner, not silence", () => {
  assert.match(camera, /atCap && \(/, "a banner is gated on atCap");
  assert.match(camera, /most pages you can scan in one batch/);
  // It names the button that gets them unstuck.
  assert.match(camera, /to grade these, then scan the/);
});

test("the cap number is still shown to the teacher on the scan screen", () => {
  // The 'up to N scanned' counters read MAX_PAGES, so raising it updates them.
  assert.match(scan, /" scanned \(up to " \+\s*\n?\s*MAX_PAGES/);
});
