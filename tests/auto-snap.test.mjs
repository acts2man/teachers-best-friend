// Auto-snap timing: capture once when a page holds steady ~1s, then wait for
// the page to change before snapping again (never double-snap the same page).
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const { autoSnapStep, initialAutoSnapState, AUTO_SNAP_DEFAULTS } = bundle("lib/auto-snap.ts");

const Q = (dx = 0) => [
  { x: dx, y: 0 },
  { x: 40 + dx, y: 0 },
  { x: 40 + dx, y: 40 },
  { x: dx, y: 40 },
];

/** Feed frames every `stepMs` and count how many times it fires. */
function run(frames) {
  let state = initialAutoSnapState;
  let fires = 0;
  const fireTimes = [];
  for (const f of frames) {
    const r = autoSnapStep(state, f, AUTO_SNAP_DEFAULTS);
    state = r.state;
    if (r.fire) {
      fires++;
      fireTimes.push(f.now);
    }
  }
  return { fires, fireTimes };
}

test("a page held steady for ~1s fires exactly once", () => {
  const frames = [];
  for (let t = 0; t <= 2000; t += 100) frames.push({ quad: Q(), now: t });
  const { fires, fireTimes } = run(frames);
  assert.equal(fires, 1, "one snap, not repeated");
  // It fires after the hold, measured from the first steady frame (t=100).
  assert.ok(fireTimes[0] >= AUTO_SNAP_DEFAULTS.holdMs, "not before the hold elapses");
});

test("it does not snap the same page twice; a new page re-arms it", () => {
  const frames = [];
  for (let t = 0; t <= 2000; t += 100) frames.push({ quad: Q(0), now: t }); // page A
  for (let t = 2100; t <= 4000; t += 100) frames.push({ quad: Q(60), now: t }); // page B (moved)
  const { fires } = run(frames);
  assert.equal(fires, 2, "one snap per distinct page");
});

test("losing the page clears the cooldown so the next page can arm", () => {
  const frames = [];
  for (let t = 0; t <= 1500; t += 100) frames.push({ quad: Q(), now: t }); // fires once
  for (let t = 1600; t <= 1900; t += 100) frames.push({ quad: null, now: t }); // page removed
  for (let t = 2000; t <= 3500; t += 100) frames.push({ quad: Q(), now: t }); // same spot, new page
  const { fires } = run(frames);
  assert.equal(fires, 2);
});

test("a page that keeps moving never auto-snaps", () => {
  const frames = [];
  let dx = 0;
  for (let t = 0; t <= 3000; t += 100) {
    dx += 40; // moves well beyond driftTol every frame
    frames.push({ quad: Q(dx), now: t });
  }
  assert.equal(run(frames).fires, 0);
});

test("no page in view never fires", () => {
  const frames = [];
  for (let t = 0; t <= 3000; t += 100) frames.push({ quad: null, now: t });
  assert.equal(run(frames).fires, 0);
});
