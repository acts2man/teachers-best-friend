// #187 review follow-ups (27 Oct 2026). Proven when:
//   (a) a photo kept only by a class scan left behind by a deleted test makes
//       the app clear that scan and ask once more -- and one still kept after
//       that is counted, so the teacher is told, never silently dropped;
//   (b) an expired class scan keeps nothing;
//   (c) one delete call reads the workspace once and the scans once, however
//       many photos it deletes -- one request, not one per photo.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build, buildSync } from "esbuild";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);

function bundle(entry, stubs) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, absWorkingDir: ROOT,
    external: ["pdfjs-dist/legacy/build/pdf.mjs", ...Object.keys(stubs)],
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  const req = (id) => (id in stubs ? stubs[id] : require(id));
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, req);
  return m.exports;
}

const U = (n) => "00000000-0000-4000-8000-00000000000" + n;
const day = 86400000;

/** Supabase over in-memory tables, counting every read. */
function fakeClient(tables, workspace, log) {
  const query = (table) => {
    const filters = [];
    const q = {
      select() { return q; },
      eq(col, v) { filters.push((r) => r[col] === v); return q; },
      gt(col, v) { filters.push((r) => r[col] > v); return q; },
      maybeSingle() { return q.then((r) => ({ data: r.data[0] ?? null, error: null })); },
      then(resolve, reject) {
        log.push("read " + table);
        return Promise.resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null }).then(resolve, reject);
      },
    };
    return q;
  };
  return {
    from: query,
    rpc: async (name) => {
      log.push("rpc " + name);
      return { data: workspace, error: null };
    },
  };
}

function server(tables, workspace, log) {
  const client = fakeClient(tables, workspace, log);
  return bundle("lib/teacher-server.ts", {
    "@/lib/supabase/server": { createClient: async () => client, hasSupabaseConfig: () => true },
    "@/lib/supabase/service": { createServiceClient: () => client },
    "next/headers": { cookies: async () => ({}), headers: async () => new Map() },
  });
}

const workspace = {
  classes: [], students: [], resources: [], lessons: [],
  assessments: [{ id: "live-test", title: "x", questions: [], responses: [], uploadIds: [U(1)], studentUploadIds: {} }],
};
const now = Date.now();
const session = (assessment_id, ids, expiresIn) => ({
  teacher_id: "t1",
  assessment_id,
  state: { piles: [ids.map((id) => ({ bodyId: id }))] },
  expires_at: new Date(now + expiresIn).toISOString(),
});

test("(b)(c) one workspace read and one scan read for the whole list; an expired scan keeps nothing", async () => {
  const log = [];
  const tables = {
    teacher_workspaces: [{ owner_id: "t1", revision: 3 }],
    class_scan_sessions: [
      session("live-test", [U(2)], day), // a scan in progress on a test that exists
      session("deleted-test", [U(3)], day), // left behind: its test is gone
      session("live-test-2", [U(4)], -day), // expired yesterday
    ],
  };
  const { uploadsStillReferenced } = server(tables, workspace, log);
  const uses = await uploadsStillReferenced("t1", [U(1), U(2), U(3), U(4), U(5)]);
  assert.deepEqual(Object.fromEntries(uses), {
    [U(1)]: { by: "workspace" },
    [U(2)]: { by: "scan", assessmentIds: ["live-test"], leftover: false },
    [U(3)]: { by: "scan", assessmentIds: ["deleted-test"], leftover: true },
  }, "the expired scan's photo and the unused one are free");
  assert.equal(log.filter((l) => l === "rpc get_workspace_json").length, 1, "one workspace read: " + log.join(", "));
  assert.equal(log.filter((l) => l === "read class_scan_sessions").length, 1, "one scan read");
});

test("(c) the batch route checks once, deletes only what is free, and says why the rest was kept", async () => {
  const calls = [];
  globalThis.__batchStub = { calls };
  const stub = `
    export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
    const s = globalThis.__batchStub;
    export const guardOrigin = () => {};
    export const writingTeacherId = async () => "t1";
    export const uploadsStillReferenced = async (owner, ids) => {
      s.calls.push(["check", ids.length]);
      return new Map([["u2", { by: "scan", assessmentIds: ["gone"], leftover: true }]]);
    };
    export const deleteDocument = async (owner, id) => { s.calls.push(["delete", id]); return id !== "u3"; };
    export const apiError = (e) => Response.json({ error: e.message }, { status: e.status ?? 500 });
  `;
  const r = await build({
    entryPoints: ["app/api/uploads/delete/route.ts"], bundle: true, platform: "node", format: "cjs", write: false,
    plugins: [{ name: "stub", setup(b) {
      b.onResolve({ filter: /^@\/lib\/teacher-server$/ }, () => ({ path: "stub", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: stub, loader: "js" }));
    } }],
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  const res = await m.exports.POST(new Request("https://x/api/uploads/delete", { method: "POST", body: JSON.stringify({ ids: ["u1", "u2", "u3", "u1"] }) }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    deleted: ["u1"], missing: ["u3"], failed: [],
    kept: [{ id: "u2", by: "scan", assessmentIds: ["gone"], leftover: true }],
  });
  assert.deepEqual(calls, [["check", 3], ["delete", "u1"], ["delete", "u3"]], "one check for the list; the kept one never reaches deleteDocument");
});

const { deleteUploads, keptInScanMessage } = bundle("lib/connection.ts", {});

function fakeFetch(replies) {
  const sent = [];
  globalThis.fetch = async (url, opts = {}) => {
    sent.push([opts.method ?? "GET", String(url), opts.body ? JSON.parse(opts.body).ids : undefined]);
    const next = replies.shift();
    return new Response(JSON.stringify(next ?? { ok: true }), { status: 200 });
  };
  return sent;
}

test("(c) thirty photos are one request", async () => {
  const ids = Array.from({ length: 30 }, (_, i) => "p" + i);
  const sent = fakeFetch([{ deleted: ids, missing: [], failed: [], kept: [] }]);
  assert.deepEqual(await deleteUploads(ids), { failed: 0, keptInScan: 0 });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].slice(0, 2), ["POST", "/api/uploads/delete"]);
});

test("(a) a photo kept by a deleted test's leftover scan: the scan is cleared and the photo asked for once more", async () => {
  const sent = fakeFetch([
    {
      deleted: ["p1"], missing: [], failed: [],
      kept: [
        { id: "p2", by: "scan", assessmentIds: ["gone"], leftover: true },
        { id: "p3", by: "workspace" },
      ],
    },
    { ok: true },
    { deleted: ["p2"], missing: [], failed: [], kept: [] },
  ]);
  assert.deepEqual(await deleteUploads(["p1", "p2", "p3"]), { failed: 0, keptInScan: 0 });
  assert.deepEqual(sent, [
    ["POST", "/api/uploads/delete", ["p1", "p2", "p3"]],
    ["DELETE", "/api/scans/session?assessmentId=gone", undefined],
    ["POST", "/api/uploads/delete", ["p2"]],
  ]);
});

test("(a) still kept after that, or kept by a scan in progress: counted, so the teacher is told", async () => {
  fakeFetch([
    {
      deleted: [], missing: [], failed: [],
      kept: [
        { id: "p1", by: "scan", assessmentIds: ["gone"], leftover: true },
        { id: "p2", by: "scan", assessmentIds: ["live"], leftover: false },
      ],
    },
    { ok: true },
    { deleted: [], missing: [], failed: [], kept: [{ id: "p1", by: "scan", assessmentIds: ["other"], leftover: false }] },
  ]);
  assert.deepEqual(await deleteUploads(["p1", "p2"]), { failed: 0, keptInScan: 2 });
  assert.match(keptInScanMessage(2), /^2 scanned pages were kept because a class scan that isn't finished still uses them\./);
  // A live scan is never cleared: only the leftover one was.
});

test("(a) a scan in progress on a test that exists is never cleared", async () => {
  const sent = fakeFetch([
    { deleted: [], missing: [], failed: [], kept: [{ id: "p1", by: "scan", assessmentIds: ["live"], leftover: false }] },
  ]);
  assert.deepEqual(await deleteUploads(["p1"]), { failed: 0, keptInScan: 1 });
  assert.equal(sent.length, 1, "no session DELETE, no retry");
});

test("every caller tells the teacher about pages a scan kept", () => {
  const files = {
    "components/teacher-assessments.tsx": 2,
    "components/teacher-classes.tsx": 2,
    "components/teacher-insights.tsx": 1,
    "components/teacher-review.tsx": 1,
    "components/teacher-scan.tsx": 2,
  };
  for (const [f, n] of Object.entries(files)) {
    const src = readFileSync(f, "utf8");
    assert.equal((src.match(/await deleteUploads\(/g) ?? []).length, n, f);
    assert.equal((src.match(/if \(keptInScan\) toast\.warning\(keptInScanMessage\(keptInScan\)\);/g) ?? []).length, n, f + ": each one warns");
  }
});
