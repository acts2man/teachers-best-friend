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
test("the sweep deletes exactly the stale stored jobs, records each, and leaves a failure", async () => {
  const pending = [
    { id: "a", provider_response_id: "resp_a" },
    { id: "b", provider_response_id: "resp_b" },
    { id: "c", provider_response_id: "resp_c" },
  ];
  const marked = [];
  const db = {
    pending: async () => pending,
    markDeleted: async (id, at) => marked.push({ id, at }),
  };
  const remove = async (id) => (id === "resp_b" ? "failed" : id === "resp_c" ? "gone" : "deleted");
  const counts = await R.sweepProviderCopies(db, "key", { remove, now: new Date("2026-11-07T00:00:00Z") });
  assert.deepEqual(counts, { checked: 3, deleted: 1, alreadyGone: 1, failed: 1 });
  assert.deepEqual(marked.map((m) => m.id), ["a", "c"], "b failed, so it is left for the next pass");
  assert.equal(marked[0].at, "2026-11-07T00:00:00.000Z");
});

test("the sweep asks for stored, undeleted jobs older than an hour", async () => {
  let askedBefore = null;
  const db = { pending: async (before) => { askedBefore = before; return []; }, markDeleted: async () => {} };
  await R.sweepProviderCopies(db, "key", { now: new Date("2026-11-07T12:00:00Z") });
  assert.equal(askedBefore, "2026-11-07T11:00:00.000Z");
});

// ---------------------------------------------------------------- the poll route, every outcome
function routeWith({ status = "completed", text = '{"questions":[]}', finalizeThrows = false }) {
  const scan = { id: "scan1", status: "analyzing", provider_response_id: "resp_x", provider_model: "m", params: { mode: "assignment", uploadIds: [], assessmentId: "t1", grade: 4, framework: "CC", subject: "Math" }, result: null };
  const updates = [];
  const deletes = [];
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
    "@/lib/page-ledger": { chargesForMode: () => false, confirmPages: async () => {}, releasePages: async () => {}, generationKey: () => "g" },
    "@/lib/analyze-server": {
      aiHttpError: (e) => e,
      getBackgroundResponse: async () => ({ status, usage: {}, incomplete_details: { reason: "x" } }),
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
  return { mod, updates, deletes };
}

const run = async (opts) => {
  const { mod, updates, deletes } = routeWith(opts);
  await mod.GET(new Request("http://x/api/analyze/scan1"), { params: Promise.resolve({ scanId: "scan1" }) });
  return { updates, deletes };
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

// ---------------------------------------------------------------- legal pages
test("the legal pages no longer claim retention is switched off, and describe the delete", async () => {
  const hwua = readFileSync("content/legal/how-we-use-ai.md", "utf8");
  assert.doesNotMatch(hwua, /retention switched off/);
  assert.match(hwua, /background job/);
  assert.match(hwua, /beyond about an hour/);
  const privacy = readFileSync("content/legal/privacy.md", "utf8");
  assert.doesNotMatch(privacy, /does not retain the content of the request/);
  const sdp = readFileSync("content/legal/student-data-privacy.md", "utf8");
  assert.doesNotMatch(sdp, /retention disabled/);
  assert.match(sdp, /within about an hour/);
  const flow = readFileSync("docs/student-data-flow.md", "utf8");
  assert.match(flow, /provider_deleted_at/);
});
