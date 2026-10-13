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
    const q = {
      select() { op = "select"; return q; },
      delete() { op = "delete"; return q; },
      eq(col, v) { filters.push([col, v]); return q; },
      then(resolve) {
        const rows = (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
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
    storage: { from: (bucket) => ({ remove: async (paths) => { log.push(`remove ${bucket} ${paths.join(",")}`); return { error: null }; } }) },
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
