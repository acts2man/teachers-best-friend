// The server backstop for lesson scans the browser never collected (Ricky,
// 16 Nov 2026). Proven when a stale 'analyzing' lesson scan is failed; the
// charged `full` version's credit (its gen:<id> page charge) is released; a
// free `flow` is failed but NOT refunded; and a recent job (maybe still
// running) is left alone. No real database.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const { sweepLessonOrphans } = bundle("lib/lesson-orphan.ts");

// A tiny query engine: the WHERE decides which rows the sweep works, so the
// stub applies the filters rather than handing everything back. update(...)
// returns a builder that is awaitable and chains eq/is, recording the final
// filter set so a test can see which rows were failed and which charges released.
function sweepDb(rows) {
  const scanUpdates = []; // { set, eqs }
  const chargeReleases = []; // { set, eqs, is }
  const builder = (sink, set) => {
    const rec = { set, eqs: {}, is: {} };
    let pushed = false;
    const push = () => { if (!pushed) { sink.push(rec); pushed = true; } };
    const b = {
      eq: (c, v) => ((rec.eqs[c] = v), push(), b),
      is: (c, v) => ((rec.is[c] = v), push(), b),
      then: (resolve) => (push(), resolve({ error: null })),
    };
    return b;
  };
  const svc = {
    from: (table) => {
      if (table === "scans") {
        let data = rows.slice();
        const q = {
          select: () => q,
          eq: (c, v) => ((data = data.filter((r) => String(r[c]) === v)), q),
          is: (c, v) => ((data = data.filter((r) => (r[c] ?? null) === v)), q),
          lt: (c, v) => ((data = data.filter((r) => String(r[c]) < v)), q),
          order: () => q,
          limit: (n) => Promise.resolve({ data: data.slice(0, n), error: null }),
        };
        return { select: () => q, update: (set) => builder(scanUpdates, set) };
      }
      return { update: (set) => builder(chargeReleases, set) }; // page_charges
    },
  };
  return { svc, scanUpdates, chargeReleases };
}

const NOW = new Date("2026-11-17T00:00:00Z");
const OLD = "2026-11-16T22:00:00.000Z"; // >1h before NOW
const RECENT = "2026-11-16T23:59:00.000Z"; // <1h before NOW
const scan = (id, over = {}) => ({
  id, teacher_id: "t1", stage: "lesson", status: "analyzing", result: null, billable: true,
  params: { lessonRun: "run-" + id, lessonPart: "full" }, created_at: OLD, ...over,
});

test("a stale full lesson orphan is failed AND its credit released", async () => {
  const { svc, scanUpdates, chargeReleases } = sweepDb([scan("full1")]);
  const counts = await sweepLessonOrphans(svc, { now: NOW });
  assert.equal(counts.checked, 1);
  assert.equal(counts.failed, 1);
  assert.equal(counts.refunded, 1);
  assert.equal(counts.more, false);
  assert.equal(scanUpdates[0].set.status, "failed");
  assert.equal(scanUpdates[0].eqs.id, "full1");
  assert.ok(scanUpdates[0].set.error, "a teacher-readable reason is stored");
  // The gen:<id> charge for this teacher is released.
  assert.equal(chargeReleases.length, 1);
  assert.equal(chargeReleases[0].set.released_at, NOW.toISOString());
  assert.equal(chargeReleases[0].eqs.teacher_id, "t1");
  assert.equal(chargeReleases[0].eqs.content_sha256, "gen:full1");
  assert.equal(chargeReleases[0].is.released_at, null);
});

test("a stale free flow orphan is failed but never refunded", async () => {
  const { svc, scanUpdates, chargeReleases } = sweepDb([
    scan("flow1", { billable: false, params: { lessonRun: "r", lessonPart: "flow" } }),
  ]);
  const counts = await sweepLessonOrphans(svc, { now: NOW });
  assert.equal(counts.failed, 1);
  assert.equal(counts.refunded, 0, "a free version has no credit to give back");
  assert.equal(scanUpdates[0].set.status, "failed");
  assert.equal(chargeReleases.length, 0, "no page charge is touched for a flow");
});

test("a recent lesson scan (maybe still running) is left alone", async () => {
  const { svc, scanUpdates } = sweepDb([scan("recent", { created_at: RECENT })]);
  const counts = await sweepLessonOrphans(svc, { now: NOW });
  assert.equal(counts.checked, 0);
  assert.equal(counts.failed, 0);
  assert.equal(scanUpdates.length, 0);
});

test("only lesson scans that are analyzing with no result qualify", async () => {
  const { svc } = sweepDb([
    scan("done", { status: "complete", result: { ok: 1 } }),
    scan("already", { status: "failed" }),
    scan("live-sync", { stage: "class_scan" }),
    scan("good"),
  ]);
  const counts = await sweepLessonOrphans(svc, { now: NOW });
  assert.equal(counts.checked, 1, "only the analyzing, no-result, stage=lesson, old row");
  assert.equal(counts.failed, 1);
});

test("a full batch signals more", async () => {
  const rows = Array.from({ length: 200 }, (_, i) => scan("s" + i));
  const { svc } = sweepDb(rows);
  const counts = await sweepLessonOrphans(svc, { now: NOW, limit: 200 });
  assert.equal(counts.more, true);
});
