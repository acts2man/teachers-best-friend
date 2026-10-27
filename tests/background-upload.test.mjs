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
  assert.match(camera, /onStudent\?: \(files: File\[\], onLanded: \(index: number\) => void, shotIds: string\[\]\) => Promise<HandoffOutcome\[\]>;/);
  const next = fn(camera, "nextStudent");
  assert.match(next, /const current = shots\.filter\(\(x\) => x\.group === group && !x\.sent\);/);
  assert.match(next, /handOver\(current, \(onLanded\) => onStudent\(files, onLanded, current\.map\(\(x\) => x\.id\)\)\);/);
  // A page leaves the saved copy only once it has landed in its pile.
  const hand = fn(camera, "handOver");
  assert.match(hand, /void start\(\(i\) => \{\s*\/\/[^\n]*\n\s*landed\.add\(ids\[i\]\);\s*void deleteShot\(ids\[i\]\)/, "a landed page leaves the restore store");
  assert.match(hand, /\{ \.\.\.x, sent: true \}/);
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
  assert.match(panel, /groups\.map\(\(g, gi\) => queueCameraStudent\(g, \(i\) => onLanded\(gi, i\), shotIds\[gi\]\)\)/, "Finished's pages too, per page");
  const queue = fn(panel, "queueCameraStudent");
  assert.match(queue, /uploadQueue\.current\s*\.then\(\(\) => landCameraStudent\(files, onLanded, shotIds\)\)/, "one student after another");
  const land = panel.slice(panel.indexOf("async function landCameraStudent("), panel.indexOf("/** Undo the last page"));
  assert.match(land, /prepared = await preparePage\(raw\);/);
  assert.match(land, /pageFailed\(raw, pile, added, false, e, shotIds\?\.\[i\]\);/, "a page that still fails waits with Retry, in its pile");
  assert.match(land, /next\[pile\]\.push\(/, "into the student's own pile, not whichever is last");
});

test("Finished waits for what is left: the panel is busy until the queue is empty", () => {
  assert.match(panel, /const busyScanning = scanning \|\| adding \|\| pendingUploads > 0;/);
  // And the other device's copy is not applied while piles change under the camera.
  assert.match(panel, /paused: adding \|\| scanning \|\| saving \|\| cameraOpen \|\| pendingUploads > 0,/);
});

// ---- #182 review (27 Oct 2026) ----

test("a refused hand-over keeps the camera's saved copy; the panel says which pages it refused", () => {
  // The panel says which: setup checks or the page limit refuse every page.
  const land = panel.slice(panel.indexOf("async function landCameraStudent("), panel.indexOf("/** Undo the last page"));
  assert.match(land, /if \(!files\.length \|\| !ready\(\)\) return refused;/);
  assert.match(land, /toast\.error\("Scan up to " \+ MAX_PAGES[\s\S]*?return refused;/);
  assert.match(land, /outcome\[i\] = "failed";/);
  assert.match(land, /outcome\[i\] = "landed";\s*onLanded\?\.\(i\);/);
  // The camera applies settleHandoff: give back the refused, saved and
  // un-marked. A failed page's copy is kept (#188 review): the panel flags it.
  const hand = fn(camera, "handOver");
  assert.match(hand, /const \{ giveBack \} = settleHandoff\(ids, outcome, landed\);/);
  assert.doesNotMatch(hand, /deleteShot\(id\)/, "no failed copy is deleted");
  assert.match(hand, /for \(const shot of pages\) if \(back\.has\(shot\.id\)\) void stored\(shot, false\);/);
  assert.match(hand, /\.then\(apply, \(\) => apply\("rejected"\)\)/);
});

test("the sent mark is saved, and a reload never offers a handed-over page", async () => {
  assert.match(fn(camera, "handOver"), /for \(const shot of pages\) void stored\(shot, true\);/);
  assert.match(camera, /const stored = restorableShots\(all, heldAtOpen\.current\);/);
  assert.match(camera, /const heldAtOpen = useRef\(new Set\(heldByPanel\)\);/);
  const { buildSync } = await import("esbuild");
  const r = buildSync({ entryPoints: ["lib/scan-store.ts"], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  const shot = (id, seq, sent) => ({ id, assessmentId: "t", group: 0, seq, blob: null, ...(sent === undefined ? {} : { sent }) });
  assert.deepEqual(
    m.exports.restorableShots([shot("c", 3), shot("a", 1, true), shot("b", 2, false)]).map((s) => s.id),
    ["b", "c"],
  );
});

// ---- #182 review, round 2 (27 Oct) ----

const store = (() => {
  return import("esbuild").then(({ buildSync }) => {
    const r = buildSync({ entryPoints: ["lib/scan-store.ts"], bundle: true, platform: "node", format: "cjs", write: false });
    const m = { exports: {} };
    new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
    return m.exports;
  });
})();

test("a failed page keeps its saved copy, flagged failed (#188 review)", async () => {
  const { settleHandoff } = await store;
  const out = settleHandoff(["a", "b", "c"], ["landed", "failed", "refused"], new Set(["a"]));
  assert.deepEqual(out, { markFailed: ["b"], giveBack: ["c"] });
  // The panel flags the copy with where the page belongs, and holds it with Retry.
  assert.match(panel, /pageFailed\(raw, pile, added, false, e, shotIds\?\.\[i\]\);\s*outcome\[i\] = "failed";/);
  const failed = fn(panel, "pageFailed");
  assert.match(failed, /if \(shotId\) void markShotFailed\(shotId, \{ pile, index, label \}\)/);
  assert.match(failed, /key: shotId \?\? crypto\.randomUUID\(\),/);
});

test("after a reload the camera offers failed pages only, and never one the panel holds", async () => {
  const { restorableShots, failedShots } = await store;
  const shot = (id, seq, extra = {}) => ({ id, assessmentId: "t", group: 0, seq, blob: null, ...extra });
  const all = [
    shot("unsent", 1),
    shot("uploading", 2, { sent: true }),
    shot("failed", 3, { sent: true, failed: true, failedAt: { pile: 1, index: 0, label: "p" } }),
    shot("held", 4, { sent: true, failed: true, failedAt: { pile: 0, index: 2, label: "q" } }),
  ];
  const held = new Set(["held"]);
  assert.deepEqual(restorableShots(all, held).map((s) => s.id), ["unsent", "failed"], "of the handed-over pages, only failed ones");
  assert.deepEqual(failedShots(all, held).map((s) => s.id), ["failed"]);
  assert.deepEqual(failedShots(all).map((s) => s.id), ["failed", "held"]);
  // Held = on the panel's Retry list: the camera is told which.
  assert.match(panel, /heldByPanel=\{failedPages\.flatMap\(\(f\) => \(f\.shotId \? \[f\.shotId\] : \[\]\)\)\}/);
});

test("the panel brings failed pages back after a reload, so grading still waits on them", () => {
  const i = panel.indexOf("// After a reload: camera pages");
  const effect = panel.slice(i, panel.indexOf("}, [a.id]);", i));
  assert.match(effect, /loadShots\(a\.id\)/);
  assert.match(effect, /failedShots\(all, held\)/, "not one already listed");
  assert.match(effect, /pile: shot\.failedAt\?\.pile \?\? 0,/, "back in its student's pile");
  assert.match(effect, /shotId: shot\.id,/);
  // Grading refuses while any page is failed.
  assert.match(panel, /if \(failedPages\.length\) \{/);
});

test("Retry landing or Leave it out deletes the saved copy; nothing else does", () => {
  const drop = fn(panel, "dropFailed");
  assert.match(drop, /if \(failed\.shotId\) void deleteShot\(failed\.shotId\)/);
  assert.match(fn(panel, "retryPage"), /placeRetriedPage\([\s\S]*?\);\s*dropFailed\(failed\);/);
  assert.match(panel, /onClick=\{\(\) => dropFailed\(f\)\}\s*>\s*Leave it out/);
  assert.doesNotMatch(panel, /setFailedPages\(\(all\) => all\.filter/, "no way out that leaves the copy behind");
});

test("the queue failing gives back only pages that had not landed", async () => {
  const { settleHandoff } = await store;
  assert.deepEqual(settleHandoff(["a", "b", "c"], "rejected", new Set(["a", "c"])), { markFailed: [], giveBack: ["b"] });
});

test("Finished keeps what the panel refuses, and tells the teacher how many", () => {
  const done = fn(camera, "done");
  const finish = done.slice(0, done.indexOf("return;"));
  assert.match(finish, /if \(onFinish\) \{/);
  assert.doesNotMatch(finish, /clearShots/, "nothing is wiped up front");
  assert.match(finish, /handOver\(pages, \(onLanded\) =>\s*onFinish\(\s*files,/);
  assert.match(panel, /const kept = outcome\.flat\(\)\.filter\(\(o\) => o === "refused"\)\.length;/);
  assert.match(panel, /" kept in the camera\. Open the camera and tap Restore to add "/);
});
