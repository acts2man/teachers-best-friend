// Two safety nets for the camera: don't discard a stack without asking, and
// survive an interruption by saving each page to IndexedDB.
//
// The IndexedDB round-trip itself needs a browser; here we prove the store is
// pure-safe (ordering, and that it never throws or blocks when IndexedDB is
// absent — the node test env has none), and pin the component wiring by source.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const store = bundle("lib/scan-store.ts");

test("orderStored sorts pages back into capture order", () => {
  const shots = [
    { id: "c", seq: 2 },
    { id: "a", seq: 0 },
    { id: "b", seq: 1 },
  ];
  assert.deepEqual(store.orderStored(shots).map((s) => s.id), ["a", "b", "c"]);
});

test("with no IndexedDB, storage degrades gracefully and never throws", async () => {
  // node has no indexedDB, so this exercises the fallback path.
  assert.equal(typeof indexedDB, "undefined");
  await assert.doesNotReject(() => store.saveShot({ id: "x", assessmentId: "a", group: 0, seq: 0, blob: new Blob(["x"]) }));
  await assert.doesNotReject(() => store.deleteShot("x"));
  await assert.doesNotReject(() => store.clearShots("a"));
  assert.deepEqual(await store.loadShots("a"), []); // reads come back empty, not an error
});

// --- component wiring ---
const src = readFileSync("components/scan-camera.tsx", "utf8");

test("closing with pages in hand asks first, with Keep scanning as default", () => {
  assert.match(src, /function requestClose\(\)[\s\S]*shots\.length > 0[\s\S]*setConfirmDiscard\(true\)/,
    "close asks when pages exist");
  assert.match(src, /onClick=\{requestClose\}/, "the close button routes through the confirm");
  assert.match(src, /Discard \{shots\.length\}/, "the prompt names the count");
  // Keep scanning is the emphasized/default action.
  assert.match(src, /className="scan-camera-btn primary"\s+autoFocus[\s\S]*Keep scanning/,
    "Keep scanning is the primary, focused button");
  assert.match(src, /onClick=\{\(\) => setConfirmDiscard\(false\)\}/, "Keep scanning just closes the prompt");
  assert.match(src, /discardAndClose[\s\S]*clearShots\(assessmentId\)/, "confirming discard clears saved pages");
});

test("each page is saved as it's captured, and deletes are mirrored", () => {
  assert.match(src, /void saveShot\(\{ id, assessmentId, group: captureGroup, seq, blob \}\)/, "saved on capture");
  assert.match(src, /void saveShot\([\s\S]*\.catch\(\(\) => \{\}\)/, "save is guarded and fire-and-forget");
  assert.match(src, /removeShot[\s\S]*void deleteShot\(id\)/, "deleting a thumbnail removes the saved page");
});

test("saving never blocks the shutter (not awaited)", () => {
  // The save happens inside the toBlob callback via `void`, never awaited on the
  // capture path, so the shutter stays instant.
  assert.ok(!/await saveShot/.test(src), "saveShot is never awaited");
});

test("reopening offers to restore, and Done clears the saved pages", () => {
  assert.match(src, /loadShots\(assessmentId\)[\s\S]*setRestorable\(/, "restore is offered on open");
  assert.match(src, /function restore\(\)[\s\S]*setShots\(restorable\)/, "restore brings the pages back");
  assert.match(src, /Unsaved pages found/, "the restore prompt is shown");
  assert.match(src, /function done\(\)[\s\S]*clearShots\(assessmentId\)/, "Done clears after handoff");
});
