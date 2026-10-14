// RULE R7: a stale browser tab never overwrites newer data. A save carries the
// revision its tab loaded; a save whose revision is not the current one is
// refused with 409, and nothing is written. docs/system-map.md, rule R7.
//
// Every save is a WHOLE-workspace replace (sync_workspace deletes what it is
// not sent -- rule R1), so a tab that loaded before another tab's save would,
// if let through, delete everything that save added.
//
// Runs the real lib/teacher-server.ts updateWorkspace against an in-memory
// stand-in for the Supabase service client: teacher_workspaces.revision, the
// sync_workspace RPC (which bumps it, as the real function does) and
// sync_workspace_if_revision (supabase/migrations/20261014120000_atomic_
// workspace_revision.sql), which checks the revision and syncs in one step.
//
// The race -- two saves carrying the SAME current revision at the same moment
// (gap G4) -- is covered by tests/invariants/atomic-revision.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundle } from "./lib/bundle.mjs";

const S = bundle("lib/teacher-server.ts", {
  "next/headers": "tests/invariants/fixtures/next-headers.cjs",
  "@/lib/supabase/server": "tests/invariants/fixtures/supabase-server.cjs",
  "@/lib/supabase/service": "tests/invariants/fixtures/supabase-service.cjs",
});

/** teacher_workspaces + sync_workspace, in memory. */
function fakeDatabase(revision) {
  const db = { revision, syncs: [] };
  db.from = (table) => {
    assert.equal(table, "teacher_workspaces");
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: db.revision === null ? null : { revision: db.revision }, error: null }) }),
      }),
    };
  };
  db.rpc = async (fn, args) => {
    // The atomic save: refuse (null) on a missing row or a revision mismatch,
    // otherwise sync and return the new revision.
    if (fn === "sync_workspace_if_revision") {
      if (db.revision === null || db.revision !== args.p_expected_revision) return { data: null, error: null };
      db.syncs.push(args.p_data);
      db.revision += 1;
      return { data: db.revision, error: null };
    }
    assert.equal(fn, "sync_workspace");
    db.syncs.push(args.p_data);
    db.revision += 1;
    return { error: null };
  };
  globalThis.__fakeSupabase = db;
  return db;
}

const workspace = (marker) => ({ classes: [{ id: "c" }], activeClassId: "c", students: [], assessments: [], marker });

test("a save carrying an old revision is refused and writes nothing", async () => {
  const db = fakeDatabase(7);
  for (const stale of [0, 3, 6]) {
    assert.equal(await S.updateWorkspace("t", workspace("stale"), stale), null, `revision ${stale} against 7 was accepted`);
  }
  assert.equal(db.syncs.length, 0, "sync_workspace ran for a stale save");
  assert.equal(db.revision, 7);
});

test("a save from the future (a revision the server never issued) is refused too", async () => {
  const db = fakeDatabase(7);
  assert.equal(await S.updateWorkspace("t", workspace("future"), 8), null);
  assert.equal(db.syncs.length, 0);
});

test("a save carrying the current revision is written and gets the next revision", async () => {
  const db = fakeDatabase(7);
  assert.equal(await S.updateWorkspace("t", workspace("fresh"), 7), 8);
  assert.equal(db.syncs.length, 1);
});

test("two tabs, one loaded before the other saved: the second save is refused", async () => {
  const db = fakeDatabase(1);
  const tabA = 1;
  const tabB = 1; // both loaded at revision 1
  const savedA = await S.updateWorkspace("t", workspace("A"), tabA);
  assert.equal(savedA, 2);
  assert.equal(await S.updateWorkspace("t", workspace("B"), tabB), null, "tab B overwrote tab A's save");
  assert.deepEqual(db.syncs.map((w) => w.marker), ["A"]);
});

test("a workspace that does not exist yet is never created by a save", async () => {
  const db = fakeDatabase(null);
  assert.equal(await S.updateWorkspace("t", workspace("x"), 0), null);
  assert.equal(db.syncs.length, 0);
});

test("the route turns a refused save into 409, and reads the revision before the data", () => {
  const route = readFileSync("app/api/workspace/route.ts", "utf8");
  assert.match(route, /const nextRevision = await updateWorkspace\(id, workspace, revision\);\s*if \(nextRevision === null\)\s*throw new HttpError\(\s*409,/);
  assert.match(route, /revision: z\.number\(\)\.int\(\)\.nonnegative\(\)/, "a save without a revision is rejected by the schema");
  const server = readFileSync("lib/teacher-server.ts", "utf8");
  const read = server.slice(server.indexOf("export async function readWorkspace("));
  assert.ok(read.indexOf("workspaceRevision(id)") < read.indexOf('"get_workspace_json"'), "readWorkspace must read the revision BEFORE the data, or a save between the two reads is missed");
});
