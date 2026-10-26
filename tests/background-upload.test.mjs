// Background upload (Ricky, 26 Oct 2026): a student's pages upload as soon as
// the teacher taps "Next Student", while they keep scanning -- not after each
// photo, so deleting a mistaken photo still works -- and "Finished" waits only
// for what is left. Uploads reuse preparePage/uploadFile's retries (#171), and
// a page that still fails waits with a Retry button in its student's pile.
// scripts/browser-check/background-upload.mjs drives it with a fake camera.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const camera = readFileSync("components/scan-camera.tsx", "utf8");
const panel = readFileSync("components/teacher-class-scan.tsx", "utf8");
const fn = (src, name) => src.slice(src.indexOf("function " + name + "("), src.indexOf("\n  }\n", src.indexOf("function " + name + "(")));

test("the camera hands a student over at Next student, not photo by photo", () => {
  assert.match(camera, /onStudent\?: \(files: File\[\]\) => Promise<void>;/);
  const next = fn(camera, "nextStudent");
  assert.match(next, /const current = shots\.filter\(\(x\) => x\.group === group && !x\.sent\);/);
  assert.match(next, /void onStudent\(files\)\.then\(\(\) => \{\s*for \(const id of ids\) void deleteShot\(id\)/, "a landed student leaves the restore store");
  assert.match(next, /\{ \.\.\.x, sent: true \}/);
  // Nothing in the shutter path hands pages over.
  assert.doesNotMatch(fn(camera, "addShot"), /onStudent/);
});

test("a photo can be deleted until its student is handed over, and not after", () => {
  assert.match(fn(camera, "removeShot"), /if \(shotsRef\.current\.find\(\(x\) => x\.id === id\)\?\.sent\) return;/);
  assert.match(camera, /disabled=\{s\.sent\}/);
});

test("Finished returns only the pages not yet handed over", () => {
  assert.match(fn(camera, "done"), /partitionByGroup\(shots\.filter\(\(x\) => !x\.sent\), group \+ 1\)/);
  assert.match(camera, /const unsent = shots\.filter\(\(x\) => !x\.sent\)\.length;/);
});

test("the panel uploads each student in order, in the background, with the existing retry", () => {
  assert.match(panel, /onStudent=\{queueCameraStudent\}/);
  assert.match(panel, /for \(const g of groups\) void queueCameraStudent\(g\);/);
  const queue = fn(panel, "queueCameraStudent");
  assert.match(queue, /uploadQueue\.current\s*\.then\(\(\) => landCameraStudent\(files\)\)/, "one student after another");
  const land = panel.slice(panel.indexOf("async function landCameraStudent("), panel.indexOf("/** Undo the last page"));
  assert.match(land, /prepared = await preparePage\(raw\);/);
  assert.match(land, /pageFailed\(raw, pile, added, false, e\);/, "a page that still fails waits with Retry, in its pile");
  assert.match(land, /next\[pile\]\.push\(/, "into the student's own pile, not whichever is last");
});

test("Finished waits for what is left: the panel is busy until the queue is empty", () => {
  assert.match(panel, /const busyScanning = scanning \|\| adding \|\| pendingUploads > 0;/);
  // And the other device's copy is not applied while piles change under the camera.
  assert.match(panel, /paused: adding \|\| scanning \|\| saving \|\| cameraOpen \|\| pendingUploads > 0,/);
});
