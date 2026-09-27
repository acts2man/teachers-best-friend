// The in-app camera's pure logic, plus the load-bearing wiring in the
// components (asserted against source, the way the other component tests do).
//
// What matters and is easy to regress: it asks for the rear camera at high
// resolution; every camera failure gives a clear message that points to
// Upload; "Next student" boundaries partition shots into per-student groups;
// and both host flows route the camera's output through the EXISTING upload
// pipeline (uploadPages / preparePage), so metering, hashing, charge-once and
// what reaches the AI are unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";

function bundle(path) {
  const result = buildSync({
    entryPoints: [path],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const shim = { exports: {} };
  new Function("module", "exports", result.outputFiles[0].text)(shim, shim.exports);
  return shim.exports;
}

const { videoConstraints, cameraSupported, describeCameraError, partitionByGroup } =
  bundle("lib/camera.ts");

test("it asks for the rear camera at the highest resolution, no audio", () => {
  const c = videoConstraints();
  assert.equal(c.audio, false);
  assert.equal(c.video.facingMode.ideal, "environment");
  // ideal (not exact) so a weaker camera still starts.
  assert.ok(c.video.width.ideal >= 3000 && c.video.height.ideal >= 3000);
});

test("cameraSupported reflects whether getUserMedia exists", () => {
  // navigator is a read-only global in Node, so swap it via defineProperty.
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const set = (value) =>
    Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
  try {
    set(undefined);
    assert.equal(cameraSupported(), false);
    set({ mediaDevices: {} });
    assert.equal(cameraSupported(), false);
    set({ mediaDevices: { getUserMedia: () => {} } });
    assert.equal(cameraSupported(), true);
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
  }
});

test("every camera failure gets a clear message that points to Upload", () => {
  const cases = {
    NotAllowedError: /blocked|allow/i,
    NotFoundError: /no camera/i,
    NotReadableError: /in use|another app/i,
    SomethingElse: /couldn.t be started/i,
  };
  for (const [name, pattern] of Object.entries(cases)) {
    const msg = describeCameraError({ name });
    assert.match(msg, pattern, name);
    assert.match(msg, /upload/i, name + " points to Upload");
  }
});

test("Next student boundaries partition shots into per-student groups", () => {
  const shots = [
    { id: "a", group: 0 },
    { id: "b", group: 0 },
    { id: "c", group: 1 },
    { id: "d", group: 2 },
  ];
  const groups = partitionByGroup(shots, 3);
  assert.deepEqual(
    groups.map((g) => g.map((s) => s.id)),
    [["a", "b"], ["c"], ["d"]],
  );
  // A student with no pages is dropped, and order is preserved.
  assert.deepEqual(
    partitionByGroup([{ id: "x", group: 0 }, { id: "y", group: 2 }], 3).map((g) =>
      g.map((s) => s.id),
    ),
    [["x"], ["y"]],
  );
  // Out-of-range groups are ignored, never crash.
  assert.deepEqual(partitionByGroup([{ id: "z", group: 5 }], 1), []);
});

// --- component wiring (source assertions) ---

test("the camera captures instantly and stays open — no review/retake", () => {
  const src = readFileSync("components/scan-camera.tsx", "utf8");
  // Capture buffers a shot in memory (setShots); it does not await an upload.
  assert.match(src, /setShots\(\(s\) => \[/, "a shot is buffered on capture");
  // No confirm/retake BUTTON between capture and buffering (prose comments aside).
  assert.ok(!/>\s*(Retake|Use Photo)\s*</i.test(src), "no retake / use-photo button");
  // Captured at the stream's real pixel size, for sharp handwriting.
  assert.match(src, /video\.videoWidth/, "captures at native resolution");
  assert.match(src, /video\.videoHeight/);
  // Thumbnail strip with tap-to-delete, and Next student only in class mode.
  assert.match(src, /removeShot\(/, "a thumbnail deletes its page");
  assert.match(src, /mode === "class" &&[\s\S]*Next student/, "Next student in class mode");
  assert.match(src, /partitionByGroup\(shots/, "Done groups shots per student");
});

test("the one-student flow opens the camera and reuses uploadPages", () => {
  const ui = readFileSync("components/teacher-review.tsx", "utf8");
  assert.match(ui, /setCameraOpen\(true\)/, "Take a photo opens the in-app camera");
  assert.match(ui, /<ScanCamera[\s\S]*mode="single"/, "single-student mode");
  assert.match(ui, /onComplete=\{\(groups\) => \{[\s\S]*uploadPages\(files\)/, "routes through the existing uploadPages");
  assert.match(ui, /onFallback=\{\(\)[\s\S]*camera\.current\?\.click\(\)/, "falls back to the file input");
});

test("Scan the class opens the camera and feeds the existing per-student grouping", () => {
  const ui = readFileSync("components/teacher-class-scan.tsx", "utf8");
  assert.match(ui, /setCameraOpen\(true\)/, "Scan a page opens the in-app camera");
  assert.match(ui, /<ScanCamera[\s\S]*mode="class"/, "class mode with Next student");
  assert.match(ui, /addCameraGroups\(groups\)/, "Done lands the groups into piles");
  // addCameraGroups uploads through preparePage (hash/metering/charge-once) and
  // opens a new pile per student boundary via functional setPiles.
  assert.match(ui, /async function addCameraGroups[\s\S]*preparePage\(raw\)/);
  assert.match(ui, /async function addCameraGroups[\s\S]*setPiles\(\(p\) => \[\.\.\.p, \[\]\]\)/);
});
