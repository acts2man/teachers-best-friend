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

// -------------------------------------------------------- backfill
function backfillDb(rows) {
  const updated = [];
  const svc = {
    from: () => ({
      select: () => ({ not: () => ({ is: () => ({ order: () => ({ limit: (n) => Promise.resolve({ data: rows.slice(0, n), error: null }) }) }) }) }),
      update: (v) => ({ eq: async (_c, id) => (updated.push({ id, ...v }), { error: null }) }),
    }),
  };
  return { svc, updated };
}
test("the backfill deletes each pending provider copy, stamps it, counts only, and signals more", async () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: "s" + i, provider_response_id: "r" + i }));
  const { svc, updated } = backfillDb(rows);
  const counts = await R.backfillProviderCopies(svc, "k", { limit: 50, remove: async (id) => (id === "r1" ? "failed" : id === "r2" ? "gone" : "deleted"), now: new Date("2026-11-10T00:00:00Z") });
  assert.equal(counts.checked, 50);
  assert.equal(counts.deleted, 48);
  assert.equal(counts.alreadyGone, 1);
  assert.equal(counts.failed, 1);
  assert.equal(counts.more, true, "a full batch means run again");
  assert.ok(!updated.some((u) => u.id === "s1"), "a failed delete leaves the stamp null for next time");
  assert.ok(updated.every((u) => u.provider_deleted_at === "2026-11-10T00:00:00.000Z"));
  assert.equal(updated.length, 49);
});
test("a short batch reports more:false (nothing left)", async () => {
  const { svc } = backfillDb([{ id: "s", provider_response_id: "r" }]);
  const counts = await R.backfillProviderCopies(svc, "k", { limit: 50, remove: async () => "deleted" });
  assert.equal(counts.more, false);
});

// -------------------------------------------------------- the poll route
function routeWith({ pollStatus }) {
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
    "@/lib/page-ledger": { chargesForMode: () => true, confirmPages: async () => {}, releasePages: async (_s, _u, ids) => released.push(...ids), generationKey: () => "g" },
    "@/lib/analyze-server": {
      aiHttpError: (e) => e,
      getBackgroundResponse: async () => { throw notFound; },
      deleteBackgroundResponse: async (id) => { deletes.push(id); return "gone"; },
      recordScanUsage: async () => {},
      shareCatalog: async () => {},
    },
    "@/lib/app-events-server": { logAiFailure: async () => {} },
    "@/lib/name-seen": { withoutNameSeen: (x) => x },
    "@/lib/lesson-billing": { incompleteMessage: () => "x", lessonPartIsFree: () => false },
    "@/lib/build-info": { buildStamp: () => "b" },
  };
  const mod = bundle("app/api/analyze/[scanId]/route.ts", { external: Object.keys(stubs), stubs });
  return { mod, updates, released };
}
for (const status of [404, 410]) {
  test(`a poll that finds the job gone (${status}) fails the scan, releases its pages, and records the deletion`, async () => {
    const { mod, updates, released } = routeWith({ pollStatus: status });
    const res = await mod.GET(new Request("http://x/api/analyze/scan1"), { params: Promise.resolve({ scanId: "scan1" }) });
    const body = await res.json();
    assert.equal(body.status, "failed");
    assert.match(body.error, /run it again|weren.t charged/i, "a clear message, not an endless spinner");
    assert.deepEqual(released, ["u1"], "the reserved page (and its credit) is handed back");
    assert.ok(updates.some((u) => u.provider_deleted_at), "the deletion is recorded");
  });
}

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
