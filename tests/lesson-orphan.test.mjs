// The server backstop for lesson scans the browser never collected (Ricky,
// 16 Nov 2026). Proven when:
//   - a plain call is a DRY RUN: it changes nothing and reports the ids it
//     would fail (review of #216, safety);
//   - with apply, a stale 'analyzing' lesson scan is failed -- only where it is
//     still 'analyzing' -- and the charged `full` version's gen:<id> credit is
//     released;
//   - a stale `flow` version of a run whose full was delivered releases the
//     run's one credit through refund_lesson_generation, counted only when the
//     function says a row changed (so a second pass gives nothing back -- never
//     two); and
//   - a recent job (maybe still running) is left alone.
// No real database.
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
// stub applies the read filters rather than handing everything back. An
// update(...) builder chains eq/is and resolves on .select(), recording the
// final filter set and returning the "changed" rows so a test can prove what
// was failed, which charges were released, and that counts track real changes.
// rpc(...) records the call and returns a configurable row count.
function sweepDb(rows, opts = {}) {
  const scanUpdates = []; // { set, eqs }
  const chargeReleases = []; // { set, eqs, is }
  const rpcCalls = []; // { fn, args }
  const chargeChanged = opts.chargeChanged ?? true;
  const rpcReturns = opts.rpcReturns ?? 0;
  const updater = (sink, set, changedRows) => {
    const rec = { set, eqs: {}, is: {} };
    const b = {
      eq: (c, v) => ((rec.eqs[c] = v), b),
      is: (c, v) => ((rec.is[c] = v), b),
      select: () => (sink.push(rec), Promise.resolve({ data: changedRows, error: null })),
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
        return { select: () => q, update: (set) => updater(scanUpdates, set, [{ id: "failed" }]) };
      }
      // page_charges
      return { update: (set) => updater(chargeReleases, set, chargeChanged ? [{ id: "charge" }] : []) };
    },
    rpc: (fn, args) => (rpcCalls.push({ fn, args }), Promise.resolve({ data: rpcReturns, error: null })),
  };
  return { svc, scanUpdates, chargeReleases, rpcCalls };
}

const NOW = new Date("2026-11-17T00:00:00Z");
const OLD = "2026-11-16T22:00:00.000Z"; // >1h before NOW
const RECENT = "2026-11-16T23:59:00.000Z"; // <1h before NOW
const scan = (id, over = {}) => ({
  id, teacher_id: "t1", stage: "lesson", status: "analyzing", result: null, billable: true,
  params: { lessonRun: "run-" + id, lessonPart: "full" }, created_at: OLD, ...over,
});

test("a plain call is a dry run: it changes nothing and reports the ids", async () => {
  const { svc, scanUpdates, chargeReleases, rpcCalls } = sweepDb([scan("full1")]);
  const counts = await sweepLessonOrphans(svc, { now: NOW }); // no apply
  assert.equal(counts.dryRun, true);
  assert.equal(counts.checked, 1);
  assert.deepEqual(counts.ids, ["full1"]);
  assert.equal(scanUpdates.length, 0, "no scan is failed");
  assert.equal(chargeReleases.length, 0, "no charge is touched");
  assert.equal(rpcCalls.length, 0, "no refund is run");
});

test("with apply, a stale full lesson orphan is failed AND its credit released", async () => {
  const { svc, scanUpdates, chargeReleases } = sweepDb([scan("full1")]);
  const counts = await sweepLessonOrphans(svc, { now: NOW, apply: true });
  assert.equal(counts.dryRun, false);
  assert.equal(counts.checked, 1);
  assert.equal(counts.failed, 1);
  assert.equal(counts.refunded, 1);
  assert.equal(counts.more, false);
  assert.equal(scanUpdates[0].set.status, "failed");
  assert.equal(scanUpdates[0].eqs.id, "full1");
  assert.equal(scanUpdates[0].eqs.status, "analyzing", "failed only while still analyzing");
  assert.ok(scanUpdates[0].set.error, "a teacher-readable reason is stored");
  // The gen:<id> charge for this teacher is released, guarded on released_at.
  assert.equal(chargeReleases.length, 1);
  assert.equal(chargeReleases[0].set.released_at, NOW.toISOString());
  assert.equal(chargeReleases[0].eqs.teacher_id, "t1");
  assert.equal(chargeReleases[0].eqs.content_sha256, "gen:full1");
  assert.equal(chargeReleases[0].is.released_at, null);
});

test("a full orphan whose credit was already released is NOT counted twice", async () => {
  // The guarded update matches no row (released_at already set); refunded stays 0.
  const { svc, chargeReleases } = sweepDb([scan("full1")], { chargeChanged: false });
  const counts = await sweepLessonOrphans(svc, { now: NOW, apply: true });
  assert.equal(counts.failed, 1);
  assert.equal(counts.refunded, 0, "nothing changed, so nothing is counted");
  assert.equal(chargeReleases.length, 1, "it still tried, guarded");
});

test("a stale flow of a delivered run releases the run's one credit, server-checked", async () => {
  const { svc, chargeReleases, rpcCalls } = sweepDb(
    [scan("flow1", { billable: false, params: { lessonRun: "r9", lessonPart: "flow" } })],
    { rpcReturns: 1 },
  );
  const counts = await sweepLessonOrphans(svc, { now: NOW, apply: true });
  assert.equal(counts.failed, 1);
  assert.equal(counts.refunded, 1, "the run's full credit comes back");
  assert.equal(chargeReleases.length, 0, "a flow has no gen charge of its own to release");
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fn, "refund_lesson_generation");
  assert.deepEqual(rpcCalls[0].args, { p_teacher: "t1", p_run: "r9" });
});

test("a flow whose run owes nothing (already refunded) gives nothing back -- never two", async () => {
  // refund_lesson_generation returns 0: the full credit was released already
  // (the client's immediate ask, or a prior pass). The sweep counts no refund.
  const { svc, rpcCalls } = sweepDb(
    [scan("flow1", { billable: false, params: { lessonRun: "r9", lessonPart: "flow" } })],
    { rpcReturns: 0 },
  );
  const counts = await sweepLessonOrphans(svc, { now: NOW, apply: true });
  assert.equal(counts.failed, 1);
  assert.equal(counts.refunded, 0);
  assert.equal(rpcCalls.length, 1, "it asked the server, which said there was nothing to give back");
});

test("a recent lesson scan (maybe still running) is left alone", async () => {
  const { svc, scanUpdates } = sweepDb([scan("recent", { created_at: RECENT })]);
  const counts = await sweepLessonOrphans(svc, { now: NOW, apply: true });
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
  const counts = await sweepLessonOrphans(svc, { now: NOW, apply: true });
  assert.equal(counts.checked, 1, "only the analyzing, no-result, stage=lesson, old row");
  assert.equal(counts.failed, 1);
});

test("a full batch signals more", async () => {
  const rows = Array.from({ length: 200 }, (_, i) => scan("s" + i));
  const { svc } = sweepDb(rows);
  const counts = await sweepLessonOrphans(svc, { now: NOW, limit: 200, apply: true });
  assert.equal(counts.more, true);
});
