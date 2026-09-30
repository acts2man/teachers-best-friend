// PR3: a document read twice should give the same answer, alignment should
// follow a fixed rubric, and uploading a stack should not be one slow page at a
// time.
//
// Reading is a pure function of the page bytes. Michael read the same test
// twice and got questions tagged 72% one time and 35% the next; the fix is to
// hand back the stored result when the exact same pages are read again, so the
// second read is instant, free, and identical instead of a fresh model call
// that can disagree with the first. These cover the JavaScript that decides
// when a prior result is reused, the banded alignment wording the model is now
// held to, and the parallel upload in the scan component.
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
    external: ["pdfjs-dist/legacy/build/pdf.mjs"],
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(
    m,
    m.exports,
    require,
  );
  return m.exports;
}

const { reusableReadMode, reusablePriorResult } = bundle("lib/analyze-server.ts");

// A chainable Supabase query stub. from(table) hands back a builder whose
// filter methods all return itself and that resolves to the response queued
// for that table. contains/containedBy record the keys so a test can assert
// the set equality the real query relies on.
function fakeSvc(responses) {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = {
        table,
        containsKeys: null,
        containedByKeys: null,
        select() {
          return q;
        },
        eq() {
          return q;
        },
        in(_col, vals) {
          q.inVals = vals;
          return q;
        },
        not() {
          return q;
        },
        contains(_col, keys) {
          q.containsKeys = keys;
          return q;
        },
        containedBy(_col, keys) {
          q.containedByKeys = keys;
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        then(resolve) {
          calls.push(q);
          resolve(responses[table]);
        },
      };
      return q;
    },
  };
}

// ---------------------------------------------------------------
// Which stages may reuse a stored read
// ---------------------------------------------------------------

test("reading modes are reusable, grading modes are not", () => {
  for (const mode of ["assignment", "passage", "roster", "answer_key"])
    assert.equal(reusableReadMode(mode), true, mode + " should reuse");
  // Grading depends on the answer key and questions the teacher can change
  // between reads, so a cached grade could be stale.
  for (const mode of ["responses", "class_scan", "writing"])
    assert.equal(reusableReadMode(mode), false, mode + " must not reuse");
});

// ---------------------------------------------------------------
// Reusing a stored result
// ---------------------------------------------------------------

test("no uploads means nothing to match, so no reuse", async () => {
  const svc = fakeSvc({});
  assert.equal(await reusablePriorResult(svc, "t1", "assignment", []), null);
  assert.equal(svc.calls.length, 0);
});

test("a grading mode is never reused even with matching pages", async () => {
  const svc = fakeSvc({});
  assert.equal(
    await reusablePriorResult(svc, "t1", "responses", ["u1"]),
    null,
  );
  assert.equal(svc.calls.length, 0);
});

test("the same pages read again hand back the stored result", async () => {
  const stored = { questions: [{ id: "q1", standard: "7.RP.3", alignment: 92 }] };
  const svc = fakeSvc({
    teacher_uploads: {
      data: [
        { id: "u1", content_sha256: "hashB" },
        { id: "u2", content_sha256: "hashA" },
      ],
      error: null,
    },
    scans: { data: [{ result: stored, created_at: "2026-09-30" }], error: null },
  });
  const out = await reusablePriorResult(svc, "t1", "assignment", ["u1", "u2"]);
  assert.deepEqual(out, stored);
  // The scan lookup must ask for set equality on the sorted, de-duplicated
  // content hashes -- both directions -- or a superset would match.
  const scanQ = svc.calls.find((c) => c.table === "scans");
  assert.deepEqual(scanQ.containsKeys, ["hashA", "hashB"]);
  assert.deepEqual(scanQ.containedByKeys, ["hashA", "hashB"]);
});

test("a missing upload row means a fresh read, not a wrong reuse", async () => {
  // One id could not be resolved to a hash, so we cannot prove the pages are
  // identical -- fall through to a real read.
  const svc = fakeSvc({
    teacher_uploads: { data: [{ id: "u1", content_sha256: "hashA" }], error: null },
  });
  assert.equal(
    await reusablePriorResult(svc, "t1", "assignment", ["u1", "u2"]),
    null,
  );
});

test("no stored scan for these pages means no reuse", async () => {
  const svc = fakeSvc({
    teacher_uploads: { data: [{ id: "u1", content_sha256: "hashA" }], error: null },
    scans: { data: [], error: null },
  });
  assert.equal(
    await reusablePriorResult(svc, "t1", "assignment", ["u1"]),
    null,
  );
});

// ---------------------------------------------------------------
// The route wires reuse in before it spends anything
// ---------------------------------------------------------------

test("the analyze route checks for a reusable read before charging", () => {
  const route = readFileSync("app/api/analyze/route.ts", "utf8");
  // Compare where each is CALLED, not imported.
  const reuseAt = route.indexOf("reusablePriorResult(svc");
  const gateAt = route.indexOf("checkSpendGate(svc");
  const startAt = route.indexOf("await startScan(");
  assert.ok(reuseAt > 0, "route must consult reusablePriorResult");
  assert.ok(
    reuseAt < gateAt && reuseAt < startAt,
    "reuse must be decided before the spend gate and before a scan is opened",
  );
});

// ---------------------------------------------------------------
// Fixed alignment bands
// ---------------------------------------------------------------

test("the assignment prompt pins alignment to fixed bands", () => {
  const shared = readFileSync("lib/analyze-shared.ts", "utf8");
  assert.match(shared, /fixed bands/);
  assert.match(shared, /90–100/);
  assert.match(shared, /directly and fully assesses/);
  // The bands must be applied the same way regardless of test length -- that is
  // the whole point of making them consistent.
  assert.match(shared, /regardless of how many questions or pages/);
});

// ---------------------------------------------------------------
// Uploading a stack in parallel, with progress shown
// ---------------------------------------------------------------

test("the scan component uploads pages together, not one at a time", () => {
  const scan = readFileSync("components/teacher-scan.tsx", "utf8");
  assert.match(
    scan,
    /Promise\.all\(prepped\.map\(\(f\) => uploadFile\(f\)\)\)/,
    "uploads should be issued in parallel",
  );
  // Straightening stays sequential to keep phone memory low.
  assert.match(scan, /for \(const raw of incoming\) prepped\.push/);
});

test("the scan component shows reading progress", () => {
  const scan = readFileSync("components/teacher-scan.tsx", "utf8");
  assert.match(scan, /aria-live="polite"/);
  assert.match(scan, /longer tests take a little longer/);
});
