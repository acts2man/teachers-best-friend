// AI-provider retention with store:false (supersedes #212/#213). Proven when:
//   - every background request is sent with store:false, so the provider
//     deletes the response automatically ~10 min after the job finishes;
//   - the provider copy is still deleted on collect, with a retrying helper
//     that treats an already-gone id (404/410) as done;
//   - a poll that finds the job gone (404/410) fails the scan with a clear
//     "run it again -- you weren't charged" message AND releases its pages,
//     and records provider_deleted_at -- no endless spinner;
//   - the one-time admin backfill deletes the provider copy of every past scan
//     that still has one, stamps provider_deleted_at, counts only, and is safe
//     to call repeatedly;
//   - the legal pages describe the ~10-minute auto-delete and the up-to-30-day
//     abuse logs, with no "retention switched off".
// No real provider calls, no real database.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
function bundle(entry, { external = [], stubs = {} } = {}) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, absWorkingDir: ROOT,
    external, alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  const req = (id) => (id in stubs ? stubs[id] : require(id));
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, req);
  return m.exports;
}
const R = bundle("lib/provider-retention.ts");

// -------------------------------------------------------- store:false
test("every background request is sent with store:false", () => {
  const src = readFileSync("lib/analyze-server.ts", "utf8");
  const start = src.slice(src.indexOf("export async function startModelBackground"));
  const body = start.slice(0, start.indexOf("export async function getBackgroundResponse"));
  assert.match(body, /store:\s*false/, "startModelBackground sends store:false");
  assert.match(body, /background:\s*true/);
  assert.doesNotMatch(body, /store:\s*true/);
});

// -------------------------------------------------------- deleteProviderCopy
function fetchStub(responses) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, method: opts?.method ?? "GET" });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { ok: next < 300, status: next };
  };
  return { impl, calls };
}
test("delete retries a 429/5xx/throw then succeeds", async () => {
  const { impl, calls } = fetchStub([429, new Error("reset"), 200]);
  assert.equal(await R.deleteProviderCopy("r", "k", { fetchImpl: impl, sleep: async () => {} }), "deleted");
  assert.equal(calls.length, 3);
});
test("an already-gone id (404 or 410) is 'gone', not a failure", async () => {
  assert.equal(await R.deleteProviderCopy("r", "k", { fetchImpl: fetchStub([404]).impl, sleep: async () => {} }), "gone");
  assert.equal(await R.deleteProviderCopy("r", "k", { fetchImpl: fetchStub([410]).impl, sleep: async () => {} }), "gone");
});
test("a non-retryable error, or exhausted retries, is 'failed'", async () => {
  assert.equal(await R.deleteProviderCopy("r", "k", { fetchImpl: fetchStub([400]).impl, sleep: async () => {} }), "failed");
  assert.equal(await R.deleteProviderCopy("r", "k", { fetchImpl: fetchStub([500, 500, 500]).impl, sleep: async () => {} }), "failed");
});
// #215 review: a deadline caps one slow delete so it cannot overrun the
// backfill request (3 x 15s timeouts + backoff would be ~46s without it).
test("a delete whose deadline has already passed makes no attempt", async () => {
  const { impl, calls } = fetchStub([200]);
  const out = await R.deleteProviderCopy("r", "k", { fetchImpl: impl, sleep: async () => {}, deadline: 0, clock: () => 10 });
  assert.equal(out, "failed");
  assert.equal(calls.length, 0, "no request once the deadline is spent");
});
test("a delete stops retrying when the deadline leaves no time for the backoff", async () => {
  let t = 0;
  const impl = async () => { t += 100; return { ok: false, status: 500 }; }; // retryable
  const calls = { n: 0 };
  const counting = async (...a) => (calls.n++, impl(...a));
  // deadline 300ms out: attempt 1 runs (t 0->100), the 500ms backoff won't fit
  // in the 200ms left, so it gives up after one try rather than three.
  const out = await R.deleteProviderCopy("r", "k", { fetchImpl: counting, sleep: async () => {}, deadline: 300, clock: () => t });
  assert.equal(out, "failed");
  assert.equal(calls.n, 1, "no retry it could not finish in time");
});

// -------------------------------------------------------- backfill
// A small query engine so the backfill's WHERE/ORDER actually decide which rows
// it works -- the point of the in-flight and wedge guards is which rows the
// query returns, so the stub has to apply them rather than hand everything back.
function backfillDb(rows) {
  const updated = [];
  const svc = {
    from: () => {
      let data = rows.slice();
      const orderBy = [];
      const q = {
        select: () => q,
        not: (c, _op, v) => ((data = data.filter((r) => r[c] !== v)), q),
        is: (c, v) => ((data = data.filter((r) => (r[c] ?? null) === v)), q),
        lt: (c, v) => ((data = data.filter((r) => (r[c] ?? 0) < v)), q),
        neq: (c, v) => ((data = data.filter((r) => r[c] !== v)), q),
        order: (c) => (orderBy.push(c), q),
        limit: (n) => {
          data.sort((a, b) => {
            for (const c of orderBy) {
              const x = a[c] ?? 0, y = b[c] ?? 0;
              if (x < y) return -1;
              if (x > y) return 1;
            }
            return 0;
          });
          return Promise.resolve({ data: data.slice(0, n), error: null });
        },
      };
      return {
        select: () => q,
        update: (v) => ({ eq: async (_c, id) => (updated.push({ id, ...v }), { error: null }) }),
      };
    },
  };
  return { svc, updated };
}
// now - 2h: old enough to work; a `created_at` ISO string sorts chronologically.
const OLD = "2026-11-09T22:00:00.000Z";
const RECENT = "2026-11-09T23:59:00.000Z"; // < 1h before NOW
const NOW = new Date("2026-11-10T00:00:00Z");
const pending = (id, over = {}) => ({ id, provider_response_id: "r" + id, provider_deleted_at: null, provider_delete_attempts: 0, status: "complete", created_at: OLD, ...over });

test("the backfill works only eligible rows: deletes each, stamps it, counts, signals more", async () => {
  const rows = Array.from({ length: 50 }, (_, i) => pending("s" + i));
  const { svc, updated } = backfillDb(rows);
  const counts = await R.backfillProviderCopies(svc, "k", {
    limit: 50, now: NOW,
    remove: async (id) => (id === "rs1" ? "failed" : id === "rs2" ? "gone" : "deleted"),
  });
  assert.equal(counts.checked, 50);
  assert.equal(counts.deleted, 48);
  assert.equal(counts.alreadyGone, 1);
  assert.equal(counts.failed, 1);
  assert.equal(counts.gaveUp, 0);
  assert.equal(counts.more, true, "a full batch means run again");
  // The deleted/gone rows get a provider_deleted_at stamp; the failed one gets
  // an attempts bump instead, not a stamp.
  assert.ok(updated.every((u) => u.id === "s1" || u.provider_deleted_at === NOW.toISOString()));
  assert.ok(!updated.some((u) => u.id === "s1" && u.provider_deleted_at), "a failed delete leaves the stamp null");
  const s1 = updated.find((u) => u.id === "s1");
  assert.equal(s1.provider_delete_attempts, 1, "the failed delete is counted");
  assert.ok(s1.provider_delete_last_error_at, "and timestamped");
});

test("the backfill never touches an in-flight job: an 'analyzing' or just-started row is skipped", async () => {
  const removed = [];
  const rows = [
    pending("ok"),
    pending("analyzing", { status: "analyzing", created_at: OLD }),
    pending("recent", { created_at: RECENT }),
  ];
  const { svc, updated } = backfillDb(rows);
  const counts = await R.backfillProviderCopies(svc, "k", {
    limit: 50, now: NOW,
    remove: async (id) => (removed.push(id), "deleted"),
  });
  assert.deepEqual(removed, ["rok"], "only the old, non-analyzing row is deleted");
  assert.equal(counts.checked, 1);
  assert.equal(counts.deleted, 1);
  assert.equal(counts.more, false);
  assert.deepEqual(updated.map((u) => u.id), ["ok"], "neither in-flight row is stamped");
});

test("the backfill gives up on a wedged row: >=5 attempts is never re-selected, and the 5th failure reports gaveUp", async () => {
  const removed = [];
  const rows = [
    pending("fresh", { provider_delete_attempts: 0 }),
    pending("nearly", { provider_delete_attempts: 4 }), // one more failure -> given up
    pending("wedged", { provider_delete_attempts: 5 }), // already past the ceiling -> not selected
  ];
  const { svc, updated } = backfillDb(rows);
  const counts = await R.backfillProviderCopies(svc, "k", {
    limit: 50, now: NOW,
    remove: async (id) => (removed.push(id), id === "rnearly" ? "failed" : "deleted"),
  });
  assert.ok(!removed.includes("rwedged"), "a row at the attempts ceiling is not retried");
  assert.equal(counts.deleted, 1, "only 'fresh' deletes");
  assert.equal(counts.failed, 0, "the 4->5 failure is not an ordinary failure");
  assert.equal(counts.gaveUp, 1, "it is reported as given up");
  const nearly = updated.find((u) => u.id === "nearly");
  assert.equal(nearly.provider_delete_attempts, 5);
  // Fewest-attempts-first: 'fresh' (0) is worked before 'nearly' (4).
  assert.deepEqual(removed, ["rfresh", "rnearly"]);
});

test("the backfill stops starting new deletes inside the end-of-budget reserve", async () => {
  const rows = Array.from({ length: 10 }, (_, i) => pending("s" + i));
  const { svc } = backfillDb(rows);
  let t = 1000;
  const counts = await R.backfillProviderCopies(svc, "k", {
    limit: 50, now: NOW, budgetMs: 20000, clock: () => t,
    remove: async () => { t += 8000; return "deleted"; }, // each delete eats 8s
  });
  // deadline = 1000 + 20000 = 21000; reserve is 6000. t=1000 -> delete (t=9000);
  // t=9000 -> delete (t=17000); t=17000 leaves 4000 < 6000 -> stop.
  assert.equal(counts.deleted, 2);
  assert.equal(counts.more, true, "there is more to do next pass");
});

test("a short batch reports more:false (nothing left)", async () => {
  const { svc } = backfillDb([pending("s")]);
  const counts = await R.backfillProviderCopies(svc, "k", { limit: 50, now: NOW, remove: async () => "deleted" });
  assert.equal(counts.more, false);
});

// -------------------------------------------------------- the poll route
function routeWith({ pollStatus, reread } = {}) {
  const scan = { id: "scan1", status: "analyzing", provider_response_id: "resp_x", provider_model: "m", params: { mode: "assignment", uploadIds: ["u1"], assessmentId: "t1", grade: 4, framework: "CC", subject: "Math" }, result: null };
  const updates = [];
  const deletes = [];
  const released = [];
  const confirmed = [];
  const usage = [];
  // The route reads the scan once up front and, in the gone-poll branch, again
  // to see whether a parallel poll settled it. First read -> the analyzing scan;
  // any later read -> `reread` (defaults to the same analyzing scan).
  let reads = 0;
  const svc = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: (reads++ === 0 ? scan : (reread ?? scan)), error: null }) }) }) }),
      update: (v) => { updates.push(v); return { eq: async () => ({ error: null }) }; },
    }),
  };
  const notFound = Object.assign(new Error("gone"), { status: pollStatus });
  const stubs = {
    "@/lib/supabase/server": { hasSupabaseConfig: () => true },
    "@/lib/supabase/service": { createServiceClient: () => svc },
    "@/lib/teacher-server": {
      owningTeacherId: async () => "teacher",
      aiConfig: async () => ({ key: "key" }),
      readWorkspace: async () => ({ data: { assessments: [] } }),
      HttpError: class HttpError extends Error { constructor(s, m) { super(m); this.status = s; } },
      apiError: (e) => ({ json: { error: e?.message }, status: e?.status ?? 500 }),
    },
    "@/lib/teacher-catalog": { catalogFor: () => [] },
    "@/lib/analyze-shared": { analyzeInput: { safeParse: (p) => ({ success: true, data: p }) }, parseModelOutput: (t) => JSON.parse(t), responseText: () => "{}", finalizeAnalysis: () => ({}) },
    "@/lib/page-ledger": { chargesForMode: () => true, confirmPages: async (_s, _u, ids) => confirmed.push(...(ids ?? [])), releasePages: async (_s, _u, ids) => released.push(...ids), generationKey: () => "g" },
    "@/lib/analyze-server": {
      aiHttpError: (e) => e,
      getBackgroundResponse: async () => { throw notFound; },
      deleteBackgroundResponse: async (id) => { deletes.push(id); return "gone"; },
      recordScanUsage: async (_s, _id, o) => { usage.push(o); },
      shareCatalog: async () => {},
    },
    "@/lib/app-events-server": { logAiFailure: async () => {} },
    "@/lib/name-seen": { withoutNameSeen: (x) => x },
    "@/lib/lesson-billing": { incompleteMessage: () => "x", lessonPartIsFree: () => false },
    "@/lib/build-info": { buildStamp: () => "b" },
  };
  const mod = bundle("app/api/analyze/[scanId]/route.ts", { external: Object.keys(stubs), stubs });
  return { mod, updates, released, confirmed, deletes, usage };
}
for (const status of [404, 410]) {
  test(`a poll that finds the job gone (${status}) fails a still-analyzing scan, releases its pages, records the deletion, and skips the DELETE`, async () => {
    const { mod, updates, released, deletes, usage } = routeWith({ pollStatus: status });
    const res = await mod.GET(new Request("http://x/api/analyze/scan1"), { params: Promise.resolve({ scanId: "scan1" }) });
    const body = await res.json();
    assert.equal(body.status, "failed");
    assert.match(body.error, /run it again|weren.t charged/i, "a clear message, not an endless spinner");
    assert.deepEqual(released, ["u1"], "the reserved page (and its credit) is handed back");
    assert.ok(updates.some((u) => u.provider_deleted_at), "the deletion is recorded");
    assert.equal(updates.filter((u) => u.provider_deleted_at).length, 1, "provider_deleted_at is written once, not twice");
    assert.deepEqual(deletes, [], "no DELETE for an id we already know is gone");
    assert.equal(usage.length, 1, "the scan is failed exactly once");
    assert.equal(usage[0].ok, false);
  });
}
// #215 review: record_scan_usage has no status guard, so a gone poll must not
// overwrite a scan a parallel poll already delivered. Re-read first; if it is no
// longer analyzing, leave it be.
test("a gone poll on a scan a parallel poll already completed leaves it complete and releases nothing", async () => {
  const done = { status: "complete", result: { questions: [{ id: "q1" }] }, error: null };
  const { mod, released, confirmed, usage, updates } = routeWith({ pollStatus: 404, reread: done });
  const res = await mod.GET(new Request("http://x/api/analyze/scan1"), { params: Promise.resolve({ scanId: "scan1" }) });
  const body = await res.json();
  assert.equal(body.status, "complete", "the delivered result stands");
  assert.deepEqual(body.result, done.result);
  assert.deepEqual(released, [], "no pages released out from under a completed scan");
  assert.deepEqual(confirmed, [], "and none re-confirmed");
  assert.equal(usage.length, 0, "record_scan_usage is never called -- the status is not overwritten");
  assert.ok(!updates.some((u) => u.provider_deleted_at), "no second provider_deleted_at write; the delivering poll already recorded it");
});

// -------------------------------------------------------- legal + docs
test("the legal pages drop 'retention switched off' and describe the ~10-minute auto-delete and 30-day abuse logs", () => {
  const flat = (f) => readFileSync(f, "utf8").replace(/\s+/g, " ");
  const LEGAL = ["content/legal/how-we-use-ai.md", "content/legal/privacy.md", "content/legal/student-data-privacy.md", "content/legal/dpa.md"];
  for (const f of LEGAL) {
    const t = flat(f);
    assert.ok(!/retention switched off|retention disabled|does not retain/i.test(t), f + " still has a false retention claim");
    assert.match(t, /background job/i, f);
    assert.match(t, /10 minutes/i, f + " must state the ~10-minute auto-delete");
    assert.match(t, /up to 30 days/i, f + " must state the 30-day abuse-log ceiling");
    assert.ok(!/within (?:about )?an hour/i.test(t), f + " must not promise within-an-hour deletion");
  }
  const sdp = flat("content/legal/student-data-privacy.md");
  assert.match(sdp, /zero data retention/i);
  assert.match(sdp, /not used to train|prohibited from training/i);
  const flow = flat("docs/student-data-flow.md");
  assert.match(flow, /store: ?false/);
  assert.match(flow, /provider_deleted_at/);
});
