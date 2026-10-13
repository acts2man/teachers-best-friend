// #124 review, follow-up c: event messages could carry a student's name in
// unquoted text ("Student Maria Lopez not found"), and short free strings in
// detail. Proven when: no name-like word in a message or detail string reaches
// a stored row, while the error itself stays readable. Names are placeholders.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const r = buildSync({ entryPoints: ["lib/app-events.ts"], bundle: true, platform: "node", format: "cjs", write: false });
const m = { exports: {} };
new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
const { scrubEventText, scrubDetail, clientEventSchema } = m.exports;

const NAMES = ["Maria", "Lopez", "Avery", "Quinn", "Montgomery-Fitzgerald", "Jose", "maria", "Hope"];

test("unquoted names are removed from messages", () => {
  for (const msg of [
    "Student Maria Lopez not found",
    "Could not match Avery Quinn to the roster",
    "Montgomery-Fitzgerald page 2 failed to upload",
    "name read failed for maria",
    "Hope Always is not a student",
  ]) {
    const out = scrubEventText(msg);
    for (const n of NAMES) assert.ok(!out.includes(n), `"${msg}" -> "${out}" still has ${n}`);
  }
});

test("the error itself stays readable", () => {
  assert.equal(scrubEventText("TypeError: Cannot read properties of undefined (reading 'length')"), "TypeError: Cannot read properties of undefined (reading \"…\")");
  assert.equal(scrubEventText("Failed to fetch"), "Failed to fetch");
  assert.equal(scrubEventText("class_scan: short"), "class_scan: short");
  assert.equal(scrubEventText("Unexpected token < in JSON at position 0"), "Unexpected token < in JSON at position 0");
  assert.match(scrubEventText("ChunkLoadError: Loading chunk 812 failed."), /^ChunkLoadError: Loading chunk 812 failed\.$/);
});

test("detail keeps numbers, booleans and fixed-shape strings only", () => {
  assert.deepEqual(scrubDetail({ mode: "class_scan", kind: "short", batch: 2, retried: true }), { mode: "class_scan", kind: "short", batch: 2, retried: true });
  assert.deepEqual(scrubDetail({ status: 500, method: "PUT", endpoint: "/api/workspace" }), { status: 500, method: "PUT", endpoint: "/api/workspace" });
  assert.deepEqual(scrubDetail({ model: "gpt-5.6-luna", effort: "medium" }), { model: "gpt-5.6-luna", effort: "medium" });
  // A name in any string -- under an unknown key, or in a known key with the wrong shape -- is dropped.
  assert.deepEqual(scrubDetail({ student: "maria", kind: "Maria Lopez", batch: 1 }), { batch: 1 });
  assert.equal(scrubDetail({ who: "Avery" }), null);
});

test("the browser's events go through the same rules on the server", () => {
  const e = clientEventSchema.parse({ type: "client_error", message: "Student Maria Lopez not found", detail: { student: "maria", status: 404 } });
  assert.ok(!/Maria|Lopez/.test(e.message));
  assert.deepEqual(e.detail, { status: 404 });
});
