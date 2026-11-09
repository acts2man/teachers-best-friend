// AI-provider retention (review of #203). Proven when:
//   - the provider's stored copy of a background job is deleted on EVERY poll
//     outcome -- a clean result, a terminal failure, AND a throw while the
//     result is being finalized -- and the deletion is recorded
//     (provider_deleted_at), while a job still running is NOT deleted;
//   - deleting retries a 429 / 5xx / dropped connection, treats an
//     already-gone id (404) as done, and reports how it went;
//   - the hourly sweep deletes exactly the stored jobs older than the cutoff
//     whose deletion is unrecorded, records each, and leaves a failed delete
//     for the next pass;
//   - the legal pages no longer claim retention is switched off.
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

// ---------------------------------------------------------------- deleteProviderCopy
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

test("delete retries a 429/5xx/throw, then succeeds", async () => {
  const { impl, calls } = fetchStub([429, new Error("reset"), 200]);
  const out = await R.deleteProviderCopy("resp_1", "key", { fetchImpl: impl, sleep: async () => {} });
  assert.equal(out, "deleted");
  assert.equal(calls.filter((c) => c.method === "DELETE").length, 3);
});

test("an already-deleted id is 'gone', not a failure", async () => {
  const { impl } = fetchStub([404]);
  assert.equal(await R.deleteProviderCopy("resp_1", "key", { fetchImpl: impl, sleep: async () => {} }), "gone");
});

test("a non-retryable error, or exhausting the retries, is 'failed'", async () => {
  assert.equal(await R.deleteProviderCopy("r", "k", { fetchImpl: fetchStub([400]).impl, sleep: async () => {} }), "failed");
  assert.equal(await R.deleteProviderCopy("r", "k", { fetchImpl: fetchStub([500, 500, 500]).impl, sleep: async () => {} }), "failed");
});

test("cancelFirst cancels before deleting (for a job that may still run)", async () => {
  const { impl, calls } = fetchStub([200, 200]);
  await R.deleteProviderCopy("resp_1", "key", { cancelFirst: true, fetchImpl: impl, sleep: async () => {} });
  assert.match(calls[0].url, /\/cancel$/);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[1].method, "DELETE");
});

// ---------------------------------------------------------------- sweep
test("the sweep deletes each job the db says is safe, records it, and counts a failure (noteFailed)", async () => {
  const pending = [
    { id: "a", provider_response_id: "resp_a" },
    { id: "b", provider_response_id: "resp_b" },
    { id: "c", provider_response_id: "resp_c" },
  ];
  const marked = [];
  const failed = [];
  const db = {
    pending: async () => pending,
    markDeleted: async (id, at) => marked.push({ id, at }),
    noteFailed: async (id) => failed.push(id),
  };
  const remove = async (id) => (id === "resp_b" ? "failed" : id === "resp_c" ? "gone" : "deleted");
  const counts = await R.sweepProviderCopies(db, "key", { remove, now: new Date("2026-11-07T00:00:00Z") });
  assert.deepEqual(counts, { checked: 3, deleted: 1, alreadyGone: 1, failed: 1, more: false });
  assert.deepEqual(marked.map((m) => m.id), ["a", "c"], "b failed, so it is left for the next pass");
  assert.deepEqual(failed, ["b"], "a failed delete is counted so a stuck job is skipped after N");
  assert.equal(marked[0].at, "2026-11-07T00:00:00.000Z");
});

test("the sweep never touches a job younger than the 30-minute floor", async () => {
  let askedBefore = null;
  const db = { pending: async (before) => { askedBefore = before; return []; }, markDeleted: async () => {}, noteFailed: async () => {} };
  await R.sweepProviderCopies(db, "key", { now: new Date("2026-11-07T12:00:00Z") });
  assert.equal(askedBefore, "2026-11-07T11:30:00.000Z", "cutoff is now minus 30 minutes");
});

test("a full batch reports more:true so the caller runs another pass", async () => {
  const db = { pending: async (_b, limit) => Array.from({ length: limit }, (_, i) => ({ id: "x" + i, provider_response_id: "r" + i })), markDeleted: async () => {}, noteFailed: async () => {} };
  const counts = await R.sweepProviderCopies(db, "key", { limit: 3, remove: async () => "deleted" });
  assert.equal(counts.more, true, "a full batch means there may be more");
  const short = { pending: async () => [{ id: "x", provider_response_id: "r" }], markDeleted: async () => {}, noteFailed: async () => {} };
  assert.equal((await R.sweepProviderCopies(short, "key", { limit: 3, remove: async () => "deleted" })).more, false);
});

test("the sweep stops when its time budget runs out, with more:true", async () => {
  const db = { pending: async () => [{ id: "a", provider_response_id: "ra" }, { id: "b", provider_response_id: "rb" }], markDeleted: async () => {}, noteFailed: async () => {} };
  let t = 0;
  const clock = () => (t += 10000); // each call jumps 10s
  const counts = await R.sweepProviderCopies(db, "key", { budgetMs: 5000, clock, remove: async () => "deleted" });
  assert.equal(counts.more, true, "budget exceeded before the batch finished");
});

// ---------------------------------------------------------------- the poll route, every outcome
function routeWith({ status = "completed", text = '{"questions":[]}', finalizeThrows = false, pollThrows = null, charges = false }) {
  const scan = { id: "scan1", status: "analyzing", provider_response_id: "resp_x", provider_model: "m", params: { mode: "assignment", uploadIds: ["u1"], assessmentId: "t1", grade: 4, framework: "CC", subject: "Math" }, result: null };
  const updates = [];
  const deletes = [];
  const released = [];
  const svc = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: scan, error: null }) }) }) }),
      update: (v) => { updates.push(v); return { eq: async () => ({ error: null }) }; },
    }),
  };
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
    "@/lib/analyze-shared": {
      analyzeInput: { safeParse: (p) => ({ success: true, data: p }) },
      parseModelOutput: (t) => JSON.parse(t),
      responseText: () => text,
      finalizeAnalysis: () => { if (finalizeThrows) throw new Error("bad shape"); return { questions: [{ id: "q" }] }; },
    },
    "@/lib/page-ledger": { chargesForMode: () => charges, confirmPages: async () => {}, releasePages: async (_svc, _u, ids) => released.push(...ids), generationKey: () => "g" },
    "@/lib/analyze-server": {
      aiHttpError: (e) => e,
      getBackgroundResponse: async () => { if (pollThrows) throw pollThrows; return { status, usage: {}, incomplete_details: { reason: "x" } }; },
      deleteBackgroundResponse: async (id) => { deletes.push(id); return "deleted"; },
      recordScanUsage: async () => {},
      shareCatalog: async () => {},
    },
    "@/lib/app-events-server": { logAiFailure: async () => {} },
    "@/lib/name-seen": { withoutNameSeen: (x) => x },
    "@/lib/lesson-billing": { incompleteMessage: () => "incomplete", lessonPartIsFree: () => false },
    "@/lib/build-info": { buildStamp: () => "b" },
  };
  const mod = bundle("app/api/analyze/[scanId]/route.ts", { external: Object.keys(stubs), stubs });
  return { mod, updates, deletes, released };
}

const run = async (opts) => {
  const { mod, updates, deletes, released } = routeWith(opts);
  const res = await mod.GET(new Request("http://x/api/analyze/scan1"), { params: Promise.resolve({ scanId: "scan1" }) });
  return { updates, deletes, released, res };
};

test("a clean result: the provider copy is deleted and the deletion recorded", async () => {
  const { deletes, updates } = await run({ status: "completed" });
  assert.deepEqual(deletes, ["resp_x"]);
  assert.ok(updates.some((u) => u.provider_deleted_at), "provider_deleted_at written");
});

test("a finalize throw still deletes the provider copy and records it", async () => {
  const { deletes, updates } = await run({ status: "completed", finalizeThrows: true });
  assert.deepEqual(deletes, ["resp_x"], "the throw does not skip the delete (review of #203)");
  assert.ok(updates.some((u) => u.provider_deleted_at));
});

test("a terminally failed job deletes the provider copy and records it", async () => {
  const { deletes, updates } = await run({ status: "failed" });
  assert.deepEqual(deletes, ["resp_x"]);
  assert.ok(updates.some((u) => u.provider_deleted_at));
});

test("a job still running is not deleted", async () => {
  const { deletes, updates } = await run({ status: "in_progress" });
  assert.deepEqual(deletes, [], "nothing to delete while it is still running");
  assert.ok(!updates.some((u) => u.provider_deleted_at));
});

test("provider copy gone (404) on poll: fail the scan, release its pages, record the deletion -- no endless spinner (#212 review b)", async () => {
  const notFound = Object.assign(new Error("not found"), { status: 404 });
  const { updates, released, res } = await run({ pollThrows: notFound, charges: true });
  assert.equal(res.json?.status ?? "failed", "failed");
  assert.deepEqual(released, ["u1"], "the reserved page is handed back");
  assert.ok(updates.some((u) => u.provider_deleted_at), "the deletion is recorded (the copy is already gone)");
});

// ---------------------------------------------------------------- start path (#212 review c)
test("the start route deletes a job whose id could not be saved, and uses an idempotency key", () => {
  const route = readFileSync("app/api/analyze/route.ts", "utf8");
  // The idempotency key (the scan id) is passed to startModelBackground.
  assert.match(route, /startModelBackground\([\s\S]*?config\.key,\s*\/\/ Idempotency key[\s\S]*?scanId,/);
  // On any failure before the id is saved, the started job is deleted.
  assert.match(route, /if \(startedProviderId\) await deleteBackgroundResponse\(startedProviderId, config\.key\)/);
  assert.match(route, /startedProviderId = null;/, "cleared once the id is safely saved, so the poll route owns it");
  const server = readFileSync("lib/analyze-server.ts", "utf8");
  assert.match(server, /"Idempotency-Key": "scan-" \+ idempotencyKey/);
});

// ---------------------------------------------------------------- legal pages
test("the legal pages describe the delete + cleanup job, the 30-day provider ceiling, and no within-an-hour promise", async () => {
  const flat = (f) => readFileSync(f, "utf8").replace(/\s+/g, " ");
  const hwua = flat("content/legal/how-we-use-ai.md");
  assert.doesNotMatch(hwua, /retention switched off/);
  assert.match(hwua, /background job/);
  assert.match(hwua, /cleanup job/);
  assert.match(hwua, /up to 30 days/);
  const privacy = flat("content/legal/privacy.md");
  assert.doesNotMatch(privacy, /does not retain the content of the request/);
  const sdp = flat("content/legal/student-data-privacy.md");
  assert.doesNotMatch(sdp, /retention disabled/);
  assert.match(sdp, /cleanup job/);
  assert.match(sdp, /up to 30 days/);
  for (const f of ["content/legal/how-we-use-ai.md", "content/legal/privacy.md", "content/legal/student-data-privacy.md", "content/legal/dpa.md", "docs/student-data-flow.md"])
    assert.ok(!/within (?:about )?an hour/i.test(readFileSync(f, "utf8")), `${f} must not promise within-an-hour deletion`);
  const flow = readFileSync("docs/student-data-flow.md", "utf8");
  assert.match(flow, /provider_deleted_at/);
  assert.match(flow, /provider-sweep/);
});
