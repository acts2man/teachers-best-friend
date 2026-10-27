// Ricky's camera list (26 Oct 2026). scripts/browser-check/camera-controls.mjs
// drives all of it in the real camera; these pin the logic and the wiring.
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
const cam = bundle("lib/camera.ts");
const src = readFileSync("components/scan-camera.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

test("the framing guide: move closer until the page fills the screen, then hold steady", () => {
  assert.equal(cam.polygonArea(rect(0, 0, 10, 20)), 200);
  assert.equal(cam.framingGuide(null, 390, 844), null, "no page found: no instruction");
  assert.equal(cam.framingGuide(rect(100, 300, 190, 250), 390, 844), "closer", "a page across 14% of the screen");
  assert.equal(cam.framingGuide(rect(20, 60, 350, 700), 390, 844), "steady", "a page across 74%");
  assert.equal(cam.FILL_FOR_STEADY, 0.45);
  assert.equal(cam.framingGuide(rect(0, 0, 390, 844 * 0.45), 390, 844), "steady", "the boundary is steady");
});

test("the guide is measured on screen, also for a page too small to outline", () => {
  assert.match(src, /const far = quad \? null : edge\.findDocumentQuad\(imgData, \{ minAreaFraction: FAR_PAGE_MIN_AREA \}\);/);
  assert.match(src, /const nextGuide = framingGuide\(\s*onScreen \?\? \(far \? far\.map/);
  // The outline and auto-snap still use only the usual detection.
  assert.match(src, /quadRef\.current = quad \? \{ quad, w: dw, h: dh, confident \} : null;/);
  assert.match(src, /\{guide === "closer" \? "Move closer" : "Hold steady"\}/);
});

test("Next student is on the right of the shutter, Finished on the left", () => {
  const controls = src.slice(src.indexOf('<div className="scan-camera-controls">'));
  const finished = controls.indexOf("Finished\n");
  const shutter = controls.indexOf('className="scan-camera-shutter"');
  const next = controls.indexOf("Next student");
  assert.ok(finished > 0 && finished < shutter && shutter < next, "Finished, shutter, Next student");
});

test("the shutter fires on the finger going down, anywhere in a 96px target", () => {
  assert.match(src, /onPointerDown=\{\(e\) => \{\s*if \(e\.pointerType === "mouse" && e\.button !== 0\) return;\s*shoot\(\);/);
  assert.match(css, /\.scan-camera-shutter\{flex:0 0 auto;width:96px;height:96px;/);
  assert.match(css, /\.scan-camera-shutter-ring\{[^}]*pointer-events:none/);
});

test("a bold Student 1, Page 1 counter", () => {
  assert.match(src, /"Student " \+ \(group \+ 1\) \+ ", Page " \+ \(inCurrent \+ 1\)/);
  assert.match(css, /\.scan-camera-count\{[^}]*font-size:22px;font-weight:800;/);
});

test("thumbnails twice as big, numbered, newest on the left", () => {
  assert.match(css, /\.scan-camera-thumb\{[^}]*height:116px;width:92px;/, "was 58x46");
  assert.match(src, /\.map\(\(s, i\) => \(\{ s, n: i \+ 1 \}\)\)\s*\.reverse\(\)/);
  assert.match(src, /<span className="scan-camera-thumb-n" aria-hidden="true">\s*\{n\}/);
});
