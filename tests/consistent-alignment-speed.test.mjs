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

const { reusableReadMode, reusablePriorResult, readReuseFingerprint } = bundle(
  "lib/analyze-server.ts",
);
const { READ_PROMPT_VERSION } = bundle("lib/analyze-shared.ts");

// A chainable Supabase query stub. from(table) hands back a builder whose
// filter methods all return itself and that resolves to the response queued for
// that table. eq() records its column/value so a test can assert the scan
// lookup filtered on the fingerprint it was given.
function fakeSvc(responses) {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = {
        table,
        filters: {},
        select() {
          return q;
        },
        eq(col, val) {
          q.filters[col] = val;
          return q;
        },
        in(_col, vals) {
          q.inVals = vals;
          return q;
        },
        not() {
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

const params = (over = {}) => ({
  mode: "assignment",
  uploadIds: ["u1", "u2"],
  subject: "Math",
  grade: 7,
  framework: "California",
  targetStandards: ["7.RP.3"],
  freshRead: false,
  ...over,
});

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
// The reuse fingerprint: more than the page bytes
// ---------------------------------------------------------------

const hashSvc = () =>
  fakeSvc({
    teacher_uploads: {
      data: [
        { id: "u1", content_sha256: "hashB" },
        { id: "u2", content_sha256: "hashA" },
      ],
      error: null,
    },
  });

test("the fingerprint folds in prompt version, mode, scope, targets, and sorted hashes", async () => {
  const fp = await readReuseFingerprint(hashSvc(), "t1", params());
  assert.equal(
    fp,
    ["v" + READ_PROMPT_VERSION, "assignment", "Math", 7, "California", "7.RP.3", "hashA,hashB"].join("|"),
  );
});

test("a different grade, framework, or target set is a different fingerprint", async () => {
  const base = await readReuseFingerprint(hashSvc(), "t1", params());
  assert.notEqual(base, await readReuseFingerprint(hashSvc(), "t1", params({ grade: 8 })));
  assert.notEqual(
    base,
    await readReuseFingerprint(hashSvc(), "t1", params({ framework: "Texas" })),
  );
  assert.notEqual(
    base,
    await readReuseFingerprint(hashSvc(), "t1", params({ targetStandards: ["7.RP.1"] })),
  );
});

test("no fingerprint for a non-read mode, no uploads, or an unresolved page", async () => {
  assert.equal(await readReuseFingerprint(hashSvc(), "t1", params({ mode: "responses" })), null);
  assert.equal(await readReuseFingerprint(hashSvc(), "t1", params({ uploadIds: [] })), null);
  // Only one of two uploads resolves to a hash -> cannot prove identical pages.
  const short = fakeSvc({
    teacher_uploads: { data: [{ id: "u1", content_sha256: "hashA" }], error: null },
  });
  assert.equal(await readReuseFingerprint(short, "t1", params()), null);
});

// ---------------------------------------------------------------
// Reusing a stored result, keyed on the fingerprint
// ---------------------------------------------------------------

test("a stored result with the same fingerprint is handed back", async () => {
  const stored = { questions: [{ id: "q1", standard: "7.RP.3", alignment: 92 }] };
  const svc = fakeSvc({ scans: { data: [{ result: stored }], error: null } });
  const out = await reusablePriorResult(svc, "t1", params(), "FP");
  assert.deepEqual(out, stored);
  // The scan lookup must filter on exactly the fingerprint it was given.
  const scanQ = svc.calls.find((c) => c.table === "scans");
  assert.equal(scanQ.filters.reuse_fingerprint, "FP");
  assert.equal(scanQ.filters.status, "complete");
  assert.equal(scanQ.filters.billable, true);
});

test("an explicit Read again never reuses, and never even queries", async () => {
  const svc = fakeSvc({ scans: { data: [{ result: { questions: [] } }], error: null } });
  assert.equal(await reusablePriorResult(svc, "t1", params({ freshRead: true }), "FP"), null);
  assert.equal(svc.calls.length, 0);
});

test("no stored scan for this fingerprint means a fresh read", async () => {
  const svc = fakeSvc({ scans: { data: [], error: null } });
  assert.equal(await reusablePriorResult(svc, "t1", params(), "FP"), null);
});

test("a broken assignment read -- a question with no standard -- is never reused", async () => {
  // Ricky's 2026-09-30 17:42:07 read: questions came back, but one had no
  // standard, which locks the student-work step. Serving it from cache would
  // reproduce the exact bug, so it must be a miss and re-read.
  const broken = {
    questions: [
      { id: "q1", standard: "7.RP.3" },
      { id: "q2", standard: "" },
    ],
  };
  const svc = fakeSvc({ scans: { data: [{ result: broken }], error: null } });
  assert.equal(await reusablePriorResult(svc, "t1", params(), "FP"), null);
});

test("an excluded question with no standard does not block reuse", async () => {
  const ok = {
    questions: [
      { id: "q1", standard: "7.RP.3" },
      { id: "q2", standard: "", excluded: true },
    ],
  };
  const svc = fakeSvc({ scans: { data: [{ result: ok }], error: null } });
  assert.deepEqual(await reusablePriorResult(svc, "t1", params(), "FP"), ok);
});

test("an assignment read with no questions is never reused", async () => {
  const svc = fakeSvc({ scans: { data: [{ result: { questions: [] } }], error: null } });
  assert.equal(await reusablePriorResult(svc, "t1", params(), "FP"), null);
});

// ---------------------------------------------------------------
// The route wires reuse in before it spends anything, and stamps the scan
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
  // Reuse is gated on the explicit-reread flag and stamps the scan for later.
  assert.match(route, /readFingerprint && !p\.freshRead/);
  assert.match(route, /reuse_fingerprint: readFingerprint/);
});

// ---------------------------------------------------------------
// The prompt version is bumped (the read prompt changed)
// ---------------------------------------------------------------

test("READ_PROMPT_VERSION has been bumped past 1", () => {
  assert.ok(READ_PROMPT_VERSION >= 2, "prompt changed, so the version must bump");
});

// ---------------------------------------------------------------
// A new column needs its migration
// ---------------------------------------------------------------

test("a migration adds the reuse_fingerprint column", () => {
  const sql = readFileSync(
    "supabase/migrations/20260930260000_scan_reuse_fingerprint.sql",
    "utf8",
  );
  assert.match(sql, /add column if not exists reuse_fingerprint text/i);
});

// ---------------------------------------------------------------
// Explicit "Read again" buttons force a fresh read; auto-reads don't
// ---------------------------------------------------------------

test("the assessment scan's Read-it-again button forces a fresh read", () => {
  const scan = readFileSync("components/teacher-scan.tsx", "utf8");
  assert.match(scan, /analyze\(undefined, false, true\)/);
  // The read fired automatically on upload must NOT force fresh (reuse allowed).
  assert.match(scan, /await analyze\(\[\.\.\.files\.map/);
  assert.match(scan, /freshRead: fresh/);
});

test("the assessment's Read-document-again button forces a fresh read", () => {
  const a = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(a, /readDocument\(a, a\.questions\.length > 0\)/);
  assert.match(a, /freshRead: fresh/);
});

test("the answer key's Read-again button forces a fresh read", () => {
  const k = readFileSync("components/teacher-answer-key.tsx", "utf8");
  assert.match(k, /readKey\(undefined, true\)/);
  assert.match(k, /freshRead: fresh/);
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
