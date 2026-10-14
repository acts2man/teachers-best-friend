// RULE R7: a stale browser tab never overwrites newer data. A save carries the
// revision its tab loaded; a save whose revision is not the current one is
// refused with 409, and nothing is written. docs/system-map.md, rule R7.
//
// Every save is a WHOLE-workspace replace (sync_workspace deletes what it is
// not sent -- rule R1), so a tab that loaded before another tab's save would,
// if let through, delete everything that save added.
//
// Runs the real lib/teacher-server.ts updateWorkspace against an in-memory
// stand-in for the Supabase service client (teacher_workspaces.revision plus
// the sync_workspace RPC, which bumps it, as the real function does).
//
// Gap G4 (closed): on Supabase the check and the write were two round trips,
// so two saves carrying the SAME current revision that arrived together could
// both pass, and the second whole-workspace replace deleted what the first
// added. Now one call, sync_workspace_checked, takes the expected revision and
// checks it under a row lock (supabase/migrations/20261014150000_*). The fake
// below makes that call atomic, as the lock does, and lets the old two-call
// path interleave, as the real network can.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundle } from "./lib/bundle.mjs";

const S = bundle("lib/teacher-server.ts", {
  "next/headers": "tests/invariants/fixtures/next-headers.cjs",
  "@/lib/supabase/server": "tests/invariants/fixtures/supabase-server.cjs",
  "@/lib/supabase/service": "tests/invariants/fixtures/supabase-service.cjs",
});

/** A turn of the event loop: where another request can get in between. */
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * teacher_workspaces + sync_workspace + sync_workspace_checked, in memory.
 * `checked: false` is a database the G4 migration has not reached yet: the
 * checked function does not exist (PostgREST answers PGRST202).
 */
function fakeDatabase(revision, { checked = true } = {}) {
  const db = { revision, syncs: [], calls: [] };
  db.from = (table) => {
    assert.equal(table, "teacher_workspaces");
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            const seen = db.revision;
            await tick();
            return { data: seen === null ? null : { revision: seen }, error: null };
          },
        }),
      }),
    };
  };
  db.rpc = async (fn, args) => {
    db.calls.push(fn);
    if (fn === "sync_workspace_checked") {
      if (!checked) return { data: null, error: { code: "PGRST202", message: "Could not find the function public.sync_workspace_checked" } };
      // Atomic, as the row lock makes it: check and write in one step.
      if (db.revision === null || db.revision !== args.p_expected_revision) return { data: null, error: null };
      db.syncs.push(args.p_data);
      db.revision += 1;
      await tick();
      return { data: db.revision, error: null };
    }
    assert.equal(fn, "sync_workspace");
    await tick();
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

test("G4: two saves with the same revision arriving together -- exactly one is written", async () => {
  const db = fakeDatabase(1);
  const [a, b] = await Promise.all([
    S.updateWorkspace("t", workspace("A"), 1),
    S.updateWorkspace("t", workspace("B"), 1),
  ]);
  assert.deepEqual([a, b].filter((x) => x !== null), [2], "one save gets revision 2, the other is refused");
  assert.equal(db.syncs.length, 1, "the second whole-workspace replace never ran");
  assert.equal(db.revision, 2);
});

test("G4: until the migration is applied, saves still work the old way rather than failing", async () => {
  const db = fakeDatabase(7, { checked: false });
  assert.equal(await S.updateWorkspace("t", workspace("fresh"), 7), 8);
  assert.equal(await S.updateWorkspace("t", workspace("stale"), 7), null);
  assert.deepEqual(db.syncs.map((w) => w.marker), ["fresh"]);
});

test("G4: the checked function locks the row before comparing, and writes in the same call", () => {
  const sql = readFileSync("supabase/migrations/20261014150000_sync_workspace_checked.sql", "utf8");
  const body = sql.slice(sql.indexOf("create or replace function public.sync_workspace_checked"));
  assert.match(body, /from public\.teacher_workspaces\s+where owner_id = p_teacher\s+for update/);
  assert.ok(body.indexOf("for update") < body.indexOf("p_expected_revision then"), "lock before compare");
  assert.ok(body.indexOf("p_expected_revision then") < body.indexOf("perform public.sync_workspace(p_teacher, p_data)"), "compare before write");
  assert.match(sql, /revoke execute on function public\.sync_workspace_checked\(uuid, jsonb, integer\) from public, anon, authenticated/);
});
