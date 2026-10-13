// #124 review, follow-up a: the teacher's own "delete my workspace data" left
// the regression-fixture copies of their students' photos behind, while full
// account deletion removed them. Proven when: deleteAllDocuments removes the
// teacher's fixture files from the private bucket AND their allow-list rows
// (which cascade to the fixture rows and test cases), and touches no other
// teacher's fixtures.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

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

/** A tiny stand-in for a Supabase client over in-memory tables. */
function fakeClient(tables, log) {
  const query = (table) => {
    const filters = [];
    let op = "select";
    let range = null;
    const q = {
      select() { op = "select"; return q; },
      delete() { op = "delete"; return q; },
      eq(col, v) { filters.push([col, v]); return q; },
      order() { return q; },
      range(a, b) { range = [a, b]; return q; },
      then(resolve) {
        let rows = (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
        if (op === "select") rows = range ? rows.slice(range[0], range[1] + 1) : rows.slice(0, 1000);
        if (op === "delete") {
          tables[table] = (tables[table] ?? []).filter((r) => !rows.includes(r));
          log.push(`delete ${table} ${rows.length}`);
          return resolve({ data: null, error: null });
        }
        return resolve({ data: rows, error: null });
      },
    };
    return q;
  };
  return {
    from: query,
    storage: {
      from: (bucket) => ({
        remove: async (paths) => {
          if (tables.__failBucket === bucket) return { error: new Error("storage unavailable") };
          log.push(`remove ${bucket} ${paths.join(",")}`);
          return { error: null };
        },
        // The bucket's folders: <teacher>/<assessment>/<file>.
        list: async (prefix, { limit = 100, offset = 0 } = {}) => {
          const names = [...new Set((tables.__files?.[bucket] ?? [])
            .filter((p) => p.startsWith(prefix + "/"))
            .map((p) => p.slice(prefix.length + 1).split("/")[0]))];
          return { data: names.slice(offset, offset + limit).map((name) => ({ name })), error: null };
        },
      }),
    },
  };
}

test("delete my data removes the teacher's fixture copies and the consent that allowed them", async () => {
  const log = [];
  const tables = {
    teacher_uploads: [{ owner_id: "t1", object_path: "t1/a.jpg" }],
    regression_fixtures: [
      { teacher_id: "t1", object_path: "fx/t1/1.jpg" },
      { teacher_id: "t1", object_path: "fx/t1/2.jpg" },
      { teacher_id: "t2", object_path: "fx/t2/1.jpg" },
    ],
    regression_fixture_allowlist: [{ teacher_id: "t1", assessment_legacy_id: "a" }, { teacher_id: "t2", assessment_legacy_id: "b" }],
  };
  const client = fakeClient(tables, log);
  const { deleteAllDocuments } = bundle("lib/teacher-server.ts", {
    "@/lib/supabase/server": { createClient: async () => client, hasSupabaseConfig: () => true },
    "@/lib/supabase/service": { createServiceClient: () => client },
    "next/headers": { cookies: async () => ({}), headers: async () => new Map() },
  });
  await deleteAllDocuments("t1");
  assert.ok(log.includes("remove teacher-documents t1/a.jpg"), "documents as before");
  assert.ok(log.includes("remove regression-fixtures fx/t1/1.jpg,fx/t1/2.jpg"), "fixture files removed: " + log.join(" | "));
  assert.deepEqual(tables.regression_fixture_allowlist.map((r) => r.teacher_id), ["t2"], "only this teacher's consent rows go");
  assert.ok(!log.some((l) => l.includes("fx/t2")), "another teacher's fixtures untouched");
});

test("a teacher with over 1,000 fixture rows, and a copy whose row was never written, loses them all", async () => {
  const log = [];
  const rows = Array.from({ length: 1203 }, (_, i) => ({ teacher_id: "t1", object_path: `t1/a${Math.floor(i / 40)}/u${i}` }));
  const tables = {
    teacher_uploads: [],
    regression_fixtures: rows,
    regression_fixture_allowlist: [{ teacher_id: "t1", assessment_legacy_id: "a0" }],
    __files: { "regression-fixtures": [...rows.map((r) => r.object_path), "t1/a0/orphan-no-row", "t2/b/keep"] },
  };
  const client = fakeClient(tables, log);
  const { deleteAllDocuments } = bundle("lib/teacher-server.ts", {
    "@/lib/supabase/server": { createClient: async () => client, hasSupabaseConfig: () => true },
    "@/lib/supabase/service": { createServiceClient: () => client },
    "next/headers": { cookies: async () => ({}), headers: async () => new Map() },
  });
  await deleteAllDocuments("t1");
  const removed = log.filter((l) => l.startsWith("remove regression-fixtures ")).flatMap((l) => l.slice("remove regression-fixtures ".length).split(","));
  assert.equal(new Set(removed).size, 1204, "all 1,203 rows' files plus the orphan");
  assert.ok(removed.includes("t1/a0/orphan-no-row"));
  assert.ok(!removed.some((p) => p.startsWith("t2/")));
  assert.ok(log.filter((l) => l.startsWith("remove regression-fixtures")).every((l) => l.split(",").length <= 500), "removed in chunks");
});

// #128 round 3, item c: the fixtures were purged AFTER the documents and the
// upload rows were already deleted, so a failure there left a half-deleted
// account -- documents gone, fixture copies of the same photos still kept.
test("the fixture copies go first: if that fails, no document or upload row has been deleted yet", async () => {
  const log = [];
  const tables = {
    teacher_uploads: [{ owner_id: "t1", object_path: "t1/a.jpg" }],
    regression_fixtures: [{ teacher_id: "t1", object_path: "fx/t1/1.jpg" }],
    regression_fixture_allowlist: [{ teacher_id: "t1", assessment_legacy_id: "a" }],
    __failBucket: "regression-fixtures",
  };
  const client = fakeClient(tables, log);
  const { deleteAllDocuments } = bundle("lib/teacher-server.ts", {
    "@/lib/supabase/server": { createClient: async () => client, hasSupabaseConfig: () => true },
    "@/lib/supabase/service": { createServiceClient: () => client },
    "next/headers": { cookies: async () => ({}), headers: async () => new Map() },
  });
  await assert.rejects(deleteAllDocuments("t1"));
  assert.ok(!log.some((l) => l.startsWith("remove teacher-documents")), "documents untouched: " + log.join(" | "));
  assert.equal(tables.teacher_uploads.length, 1, "upload rows untouched");
  // And when it works, the fixtures (agreement, then files) go before any document.
  delete tables.__failBucket;
  log.length = 0;
  await deleteAllDocuments("t1");
  const firstDoc = log.findIndex((l) => l.startsWith("remove teacher-documents"));
  const fixtureSteps = log.map((l, i) => [l, i]).filter(([l]) => /regression-fixtures|regression_fixture_allowlist/.test(l)).map(([, i]) => i);
  assert.ok(fixtureSteps.length >= 2 && fixtureSteps.every((i) => i < firstDoc), "fixtures first: " + log.join(" | "));
  assert.ok(log.indexOf("delete regression_fixture_allowlist 1") < log.findIndex((l) => l.startsWith("remove regression-fixtures")), "the agreement before the files");
  assert.ok(log.includes("remove teacher-documents t1/a.jpg"));
});

// #128 round-3 confirmation review: a copy already in flight when the teacher
// withdraws their agreement uploads its file, then fails to record it (the
// row's foreign key refuses it). That file must not outlive "delete my data":
// copyFixtures removes what it just uploaded when the record fails.
test("a copy whose record fails removes the file it just uploaded", async () => {
  const log = [];
  const ws = { classes: [], students: [], assessments: [{ id: "a1", classId: "c", title: "t", questions: [], responses: [], studentUploadIds: { s1: ["p1"] }, uploadIds: ["p1"] }] };
  const rows = {
    regression_fixture_allowlist: [{ teacher_id: "t1", assessment_legacy_id: "a1" }],
    teacher_uploads: [{ id: "p1", name: "scan-1.jpg", created_at: "2026-10-12T03:00:00Z", object_path: "t1/p1", mime: "image/jpeg", size: 10, content_sha256: "x", purged_at: null }],
    regression_fixtures: [],
  };
  const svc = {
    rpc: async () => ({ data: ws, error: null }),
    from: (table) => {
      let op = "select";
      const q = {
        select() { return q; }, eq() { return q; }, in() { return q; }, gte() { return q; }, lte() { return q; }, order() { return q; },
        like() { op = "near"; return q; },
        upsert() { op = "upsert"; return q; },
        maybeSingle() { return q; },
        then(resolve) {
          if (op === "upsert") return resolve({ data: null, error: { message: "insert violates foreign key constraint" } });
          return resolve({ data: op === "near" ? [] : rows[table] ?? [], error: null });
        },
      };
      return q;
    },
    storage: {
      from: (bucket) => ({
        download: async () => ({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null }),
        upload: async (path) => { log.push(`upload ${bucket} ${path}`); return { error: null }; },
        remove: async (paths) => { log.push(`remove ${bucket} ${paths.join(",")}`); return { error: null }; },
      }),
    },
  };
  const { copyFixtures } = bundle("lib/regression/fixtures.ts", {});
  await assert.rejects(copyFixtures(svc, "a1"), /Recording a copied photo failed/);
  assert.deepEqual(log, ["upload regression-fixtures t1/a1/p1", "remove regression-fixtures t1/a1/p1"]);
});
