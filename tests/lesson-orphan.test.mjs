// The server backstop for lesson scans the browser never collected (Ricky,
// 16 Nov 2026). Proven when:
//   - a plain call is a DRY RUN: it changes nothing and projects
//     wouldFail/wouldRefund from the real charge state (review of #216);
//   - with apply, a stale 'analyzing' lesson scan is failed (only while still
//     analyzing) and the credit it owes is released;
//   - a stale `flow` of a run whose `full` was DELIVERED releases the run's
//     full credit DIRECTLY by gen:<full id>, of ANY age (a full 3 days old),
//     counted only when a charge row changed, and never a second time;
//   - the credit is released BEFORE the scan is failed (crash-safe); and
//   - a recent job (maybe still running) is left alone.
// Modelled tables; no real database. The age check is real, not faked away.
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

// A small modelled store: `scans` and `page_charges` as mutable arrays. The
// stub honours eq/is/lt (including jsonb `params->>key`), order, limit for
// reads, and mutates matching rows on an update(...).select(), returning only
// the rows it changed -- so the sweep's "count only a real change" is exercised.
function sweepDb({ scans = [], charges = [] } = {}) {
  const colVal = (r, c) => (c.includes("->>") ? r.params?.[c.split("->>")[1]] : r[c]);
  const reader = (arr) => {
    let data = arr.slice();
    const q = {
      select: () => q,
      eq: (c, v) => ((data = data.filter((r) => String(colVal(r, c)) === String(v))), q),
      is: (c, v) => ((data = data.filter((r) => (colVal(r, c) ?? null) === v)), q),
      lt: (c, v) => ((data = data.filter((r) => String(colVal(r, c)) < String(v))), q),
      order: () => q,
      limit: (n) => Promise.resolve({ data: data.slice(0, n), error: null }),
    };
    return q;
  };
  const updater = (arr, set) => {
    const eqs = {}, isn = {};
    const b = {
      eq: (c, v) => ((eqs[c] = v), b),
      is: (c, v) => ((isn[c] = v), b),
      select: () => {
        const changed = [];
        for (const r of arr) {
          const ok =
            Object.entries(eqs).every(([c, v]) => String(colVal(r, c)) === String(v)) &&
            Object.entries(isn).every(([c, v]) => (colVal(r, c) ?? null) === v);
          if (ok) { Object.assign(r, set); changed.push({ ...r }); }
        }
        return Promise.resolve({ data: changed, error: null });
      },
    };
    return b;
  };
  const svc = {
    from: (t) => {
      const arr = t === "scans" ? scans : charges;
      return { select: () => reader(arr), update: (set) => updater(arr, set) };
    },
  };
  return { svc, scans, charges };
}

const NOW = new Date("2026-11-17T00:00:00Z");
const OLD = "2026-11-16T22:00:00.000Z"; // >1h before NOW
const RECENT = "2026-11-16T23:59:00.000Z"; // <1h before NOW
const THREE_DAYS = "2026-11-14T00:00:00.000Z"; // well past the refund fn's 2h window
const fullOrphan = (id, over = {}) => ({
  id, teacher_id: "t1", stage: "lesson", status: "analyzing", result: null, billable: true,
  params: { lessonRun: "run-" + id, lessonPart: "full" }, created_at: OLD, ...over,
});

test("a plain call is a dry run: it changes nothing and projects would-counts", async () => {
  const db = sweepDb({
    scans: [fullOrphan("full1")],
    charges: [{ id: "c1", teacher_id: "t1", content_sha256: "gen:full1", released_at: null }],
  });
  const counts = await sweepLessonOrphans(db.svc, { now: NOW });
  assert.equal(counts.dryRun, true);
  assert.equal(counts.checked, 1);
  assert.deepEqual(counts.ids, ["full1"]);
  assert.equal(counts.wouldFail, 1);
  assert.equal(counts.wouldRefund, 1, "projected from the real unreleased charge");
  assert.equal(counts.failed, undefined);
  assert.equal(db.scans[0].status, "analyzing", "nothing failed");
  assert.equal(db.charges[0].released_at, null, "nothing released");
});

test("dry run projects no refund when the charge is already released", async () => {
  const db = sweepDb({
    scans: [fullOrphan("full1")],
    charges: [{ id: "c1", teacher_id: "t1", content_sha256: "gen:full1", released_at: "2026-11-16T12:00:00Z" }],
  });
  const counts = await sweepLessonOrphans(db.svc, { now: NOW });
  assert.equal(counts.wouldFail, 1);
  assert.equal(counts.wouldRefund, 0);
});

test("with apply, a stale full lesson orphan is failed AND its credit released", async () => {
  const db = sweepDb({
    scans: [fullOrphan("full1")],
    charges: [{ id: "c1", teacher_id: "t1", content_sha256: "gen:full1", released_at: null }],
  });
  const counts = await sweepLessonOrphans(db.svc, { now: NOW, apply: true });
  assert.equal(counts.dryRun, false);
  assert.equal(counts.failed, 1);
  assert.equal(counts.refunded, 1);
  assert.equal(counts.more, false);
  assert.equal(db.scans[0].status, "failed");
  assert.ok(db.scans[0].error, "a teacher-readable reason is stored");
  assert.equal(db.charges[0].released_at, NOW.toISOString(), "the gen charge is released");
});

test("a lost flow of a run whose full is 3 days old still refunds the run's one credit", async () => {
  // The refund function's 2-hour window could not reach this; the sweep does.
  const db = sweepDb({
    scans: [
      // The delivered full, 3 days old (not an orphan: complete, has a result).
      { id: "full9", teacher_id: "t1", stage: "lesson", status: "complete", result: { ok: 1 }, billable: true,
        params: { lessonRun: "run9", lessonPart: "full" }, created_at: THREE_DAYS },
      // The lost free flow version, now a stale orphan.
      { id: "flow9", teacher_id: "t1", stage: "lesson", status: "analyzing", result: null, billable: false,
        params: { lessonRun: "run9", lessonPart: "flow" }, created_at: OLD },
    ],
    charges: [{ id: "c9", teacher_id: "t1", content_sha256: "gen:full9", released_at: null }],
  });
  const first = await sweepLessonOrphans(db.svc, { now: NOW, apply: true });
  assert.equal(first.failed, 1, "the flow orphan is failed");
  assert.equal(first.refunded, 1, "exactly one credit back");
  assert.equal(db.charges[0].released_at, NOW.toISOString());
  assert.equal(db.scans.find((s) => s.id === "flow9").status, "failed");
  // A second sweep must not refund again (the flow is no longer analyzing, and
  // the charge is already released).
  const second = await sweepLessonOrphans(db.svc, { now: new Date("2026-11-17T01:00:00Z"), apply: true });
  assert.equal(second.checked, 0);
  assert.equal(second.refunded, 0, "never a second credit");
});

test("the credit is released before the scan is failed (crash-safe order)", async () => {
  // Make the scan update throw: the release must already have happened.
  const db = sweepDb({
    scans: [fullOrphan("full1")],
    charges: [{ id: "c1", teacher_id: "t1", content_sha256: "gen:full1", released_at: null }],
  });
  const realFrom = db.svc.from;
  db.svc.from = (t) => {
    if (t === "scans") {
      const base = realFrom(t);
      return { select: base.select, update: () => ({ eq() { return this; }, is() { return this; }, select: () => Promise.reject(new Error("crash")) }) };
    }
    return realFrom(t);
  };
  await sweepLessonOrphans(db.svc, { now: NOW, apply: true }).catch(() => {});
  assert.equal(db.charges[0].released_at, NOW.toISOString(), "credit released even though failing crashed");
});

test("a flow whose run's full was never delivered gives nothing back", async () => {
  const db = sweepDb({
    scans: [
      { id: "fullX", teacher_id: "t1", stage: "lesson", status: "analyzing", result: null, billable: true,
        params: { lessonRun: "runX", lessonPart: "full" }, created_at: OLD },
      { id: "flowX", teacher_id: "t1", stage: "lesson", status: "analyzing", result: null, billable: false,
        params: { lessonRun: "runX", lessonPart: "flow" }, created_at: OLD },
    ],
    charges: [],
  });
  const counts = await sweepLessonOrphans(db.svc, { now: NOW, apply: true });
  // fullX is itself a charged orphan (its own gen charge would release, but no
  // charge row exists here), flowX's run full is not 'complete' so no refund.
  assert.equal(counts.refunded, 0, "no delivered full, no charge rows -> nothing released");
  assert.equal(counts.failed, 2, "both orphans are still failed");
});

test("two lost flows of one run refund the run's single credit only once", async () => {
  const db = sweepDb({
    scans: [
      { id: "full2", teacher_id: "t1", stage: "lesson", status: "complete", result: { ok: 1 }, billable: true,
        params: { lessonRun: "run2", lessonPart: "full" }, created_at: THREE_DAYS },
      { id: "flowA", teacher_id: "t1", stage: "lesson", status: "analyzing", result: null, billable: false,
        params: { lessonRun: "run2", lessonPart: "flow" }, created_at: OLD },
      { id: "flowB", teacher_id: "t1", stage: "lesson", status: "analyzing", result: null, billable: false,
        params: { lessonRun: "run2", lessonPart: "flow" }, created_at: OLD },
    ],
    charges: [{ id: "c2", teacher_id: "t1", content_sha256: "gen:full2", released_at: null }],
  });
  const dry = await sweepLessonOrphans(db.svc, { now: NOW });
  assert.equal(dry.wouldRefund, 1, "projection dedupes the shared charge");
  const apply = await sweepLessonOrphans(db.svc, { now: NOW, apply: true });
  assert.equal(apply.failed, 2, "both flows failed");
  assert.equal(apply.refunded, 1, "the run owes one credit, released once");
});

test("a recent lesson scan (maybe still running) is left alone", async () => {
  const db = sweepDb({ scans: [fullOrphan("recent", { created_at: RECENT })] });
  const counts = await sweepLessonOrphans(db.svc, { now: NOW, apply: true });
  assert.equal(counts.checked, 0);
  assert.equal(counts.failed, 0);
});

test("only lesson scans that are analyzing with no result qualify", async () => {
  const db = sweepDb({
    scans: [
      fullOrphan("done", { status: "complete", result: { ok: 1 } }),
      fullOrphan("already", { status: "failed" }),
      fullOrphan("live-sync", { stage: "class_scan" }),
      fullOrphan("good"),
    ],
    charges: [{ id: "cg", teacher_id: "t1", content_sha256: "gen:good", released_at: null }],
  });
  const counts = await sweepLessonOrphans(db.svc, { now: NOW, apply: true });
  assert.equal(counts.checked, 1, "only the analyzing, no-result, stage=lesson, old row");
  assert.equal(counts.failed, 1);
});

test("a full batch signals more", async () => {
  const rows = Array.from({ length: 200 }, (_, i) => fullOrphan("s" + i));
  const db = sweepDb({ scans: rows });
  const counts = await sweepLessonOrphans(db.svc, { now: NOW, limit: 200, apply: true });
  assert.equal(counts.more, true);
});
