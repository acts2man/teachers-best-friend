// RULE R7, gap G4: two saves carrying the SAME current revision that arrive at
// the same moment must not both be written. docs/system-map.md, rule R7.
//
// Every save is a whole-workspace replace (rule R1). When the revision check
// and the write were two round trips (read teacher_workspaces.revision, then
// call sync_workspace), two tabs that loaded the same revision could both pass
// the check, and the second replace deleted whatever the first had added.
//
// The fix is sync_workspace_if_revision
// (supabase/migrations/20261014120000_atomic_workspace_revision.sql): it locks
// the teacher_workspaces row, compares the revision and syncs, all in one
// transaction. These tests run the real lib/teacher-server.ts updateWorkspace
// against an in-memory database that models that row lock, plus a slow
// sync_workspace so the two saves really overlap.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundle } from "./lib/bundle.mjs";

const S = bundle("lib/teacher-server.ts", {
  "next/headers": "tests/invariants/fixtures/next-headers.cjs",
  "@/lib/supabase/server": "tests/invariants/fixtures/supabase-server.cjs",
  "@/lib/supabase/service": "tests/invariants/fixtures/supabase-service.cjs",
});

const MIGRATION = "supabase/migrations/20261014120000_atomic_workspace_revision.sql";
const tick = () => new Promise((r) => setTimeout(r, 5));

/**
 * teacher_workspaces + sync_workspace (slow: it yields before writing) +
 * sync_workspace_if_revision, which holds a per-teacher lock across its check
 * and its sync -- the `select ... for update` of the real function.
 * `atomic: false` models the database before the migration: the function is
 * missing and PostgREST answers PGRST202.
 */
function fakeDatabase(revision, { atomic = true } = {}) {
  const db = { revision, syncs: [], calls: [], reads: 0 };
  let lock = Promise.resolve();
  const sync = async (args) => {
    await tick(); // the sync takes time: a second request can arrive meanwhile
    db.syncs.push(args.p_data.marker);
    db.revision += 1;
  };
  db.from = (table) => {
    assert.equal(table, "teacher_workspaces");
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            db.reads += 1;
            await tick();
            return { data: db.revision === null ? null : { revision: db.revision }, error: null };
          },
        }),
      }),
    };
  };
  db.rpc = async (fn, args) => {
    db.calls.push(fn);
    if (fn === "sync_workspace") {
      await sync(args);
      return { data: null, error: null };
    }
    assert.equal(fn, "sync_workspace_if_revision");
    if (!atomic)
      return { data: null, error: { code: "PGRST202", message: "Could not find the function public.sync_workspace_if_revision" } };
    // Row lock: wait for any earlier holder, then hold it through the sync.
    const held = lock;
    let release;
    lock = new Promise((r) => (release = r));
    await held;
    try {
      if (db.revision === null || db.revision !== args.p_expected_revision) return { data: null, error: null };
      await sync(args);
      return { data: db.revision, error: null };
    } finally {
      release();
    }
  };
  globalThis.__fakeSupabase = db;
  return db;
}

const workspace = (marker) => ({ classes: [{ id: "c" }], activeClassId: "c", students: [], assessments: [], marker });

test("two saves carrying the same revision at the same moment: exactly one is written", async () => {
  const db = fakeDatabase(4);
  const results = await Promise.all([
    S.updateWorkspace("t", workspace("A"), 4),
    S.updateWorkspace("t", workspace("B"), 4),
  ]);
  assert.deepEqual(
    results.filter((r) => r !== null),
    [5],
    `both saves passed the revision check (results ${JSON.stringify(results)}, syncs ${JSON.stringify(db.syncs)}): the second whole-workspace replace would delete what the first added (gap G4)`,
  );
  assert.equal(results.filter((r) => r === null).length, 1, "the losing save must come back null so the route answers 409");
  assert.equal(db.syncs.length, 1, `sync_workspace ran ${db.syncs.length} times`);
  assert.equal(db.revision, 5);
});

test("five tabs at the same revision: one write, four 409s", async () => {
  const db = fakeDatabase(10);
  const results = await Promise.all(["A", "B", "C", "D", "E"].map((m) => S.updateWorkspace("t", workspace(m), 10)));
  assert.equal(results.filter((r) => r === 11).length, 1, JSON.stringify(results));
  assert.equal(results.filter((r) => r === null).length, 4, JSON.stringify(results));
  assert.equal(db.syncs.length, 1);
});

test("the save goes through the atomic function, carrying the revision", async () => {
  const db = fakeDatabase(2);
  assert.equal(await S.updateWorkspace("t", workspace("A"), 2), 3);
  assert.deepEqual(db.calls, ["sync_workspace_if_revision"], "the check and the write must be one call");
  assert.equal(await S.updateWorkspace("t", workspace("B"), 2), null, "an old revision must be refused");
  assert.deepEqual(db.syncs, ["A"]);
});

test("before the migration is applied, saves fall back to the old check, and EVERY fallback is logged", async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const db = fakeDatabase(7, { atomic: false });
    assert.equal(await S.updateWorkspace("t", workspace("A"), 7), 8, "a current save must still be written");
    assert.equal(await S.updateWorkspace("t", workspace("B"), 7), null, "a stale save must still be refused");
    assert.deepEqual(db.syncs, ["A"]);
    const missing = errors.filter((e) => e.includes("sync_workspace_if_revision") && e.includes("G4"));
    assert.equal(missing.length, 2, `expected a log line for each of the 2 fallback saves, got ${missing.length}`);
  } finally {
    console.error = original;
  }
});

for (const [code, message] of [
  ["P0001", "IMPERSONATION_ACTIVE"],
  // A 42883 raised INSIDE the function: the direct sync would hit it too, so
  // it is a failure, not a reason to take the non-atomic path.
  ["42883", "function public.safe_int(text) does not exist"],
]) {
  test(`any other database error (${code}) is a failed save, not a fallback to the non-atomic path`, async () => {
    const db = fakeDatabase(1);
    const calls = [];
    db.rpc = async (fn) => {
      calls.push(fn);
      return { data: null, error: { code, message } };
    };
    await assert.rejects(S.updateWorkspace("t", workspace("A"), 1), (e) => e.status === 500);
    assert.deepEqual(calls, ["sync_workspace_if_revision"], "fell back to a direct sync_workspace call");
    assert.equal(db.reads, 0, "fell back to reading the revision separately (the non-atomic check)");
  });
}

test("the reset (replaceWorkspace) takes the same lock-first path, with the revision it read", async () => {
  const db = fakeDatabase(3);
  await S.replaceWorkspace("t", workspace("reset"));
  assert.deepEqual(db.calls, ["sync_workspace_if_revision"], "a direct sync_workspace can deadlock with a locked save");
  assert.deepEqual(db.syncs, ["reset"]);
  assert.equal(db.revision, 4);
});

test("a reset racing a save: both land, one after the other, through the lock", async () => {
  const db = fakeDatabase(3);
  const [saved] = await Promise.all([
    S.updateWorkspace("t", workspace("save"), 3),
    S.replaceWorkspace("t", workspace("reset")),
  ]);
  assert.equal(saved, 4);
  assert.deepEqual(db.syncs, ["save", "reset"], "the reset must win, after the save");
  assert.ok(!db.calls.includes("sync_workspace"), `a direct sync_workspace ran: ${db.calls}`);
});

test("a reset that loses the race twice is a retryable 409, never an unlocked direct sync", async () => {
  const db = fakeDatabase(3);
  // Another save lands between every read and every locked call.
  db.from = () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { revision: db.revision++ }, error: null }) }) }),
  });
  await assert.rejects(S.replaceWorkspace("t", workspace("reset")), (e) => e.status === 409 && /changed while it was being reset/.test(e.message));
  assert.deepEqual(db.calls, ["sync_workspace_if_revision", "sync_workspace_if_revision"], `a direct sync_workspace ran: ${db.calls}`);
  assert.deepEqual(db.syncs, []);
});

test("a reset with no workspace row, or before the migration, syncs directly", async () => {
  const fresh = fakeDatabase(null);
  fresh.revision = null;
  // No row: the locked function would refuse, so the reset syncs directly.
  fresh.rpc = async (fn) => {
    fresh.calls.push(fn);
    assert.equal(fn, "sync_workspace");
    fresh.syncs.push("reset");
    return { data: null, error: null };
  };
  await S.replaceWorkspace("t", workspace("reset"));
  assert.deepEqual(fresh.calls, ["sync_workspace"]);

  const original = console.error;
  console.error = () => {};
  try {
    const db = fakeDatabase(2, { atomic: false });
    await S.replaceWorkspace("t", workspace("reset"));
    assert.deepEqual(db.calls, ["sync_workspace_if_revision", "sync_workspace"]);
    assert.deepEqual(db.syncs, ["reset"]);
  } finally {
    console.error = original;
  }
});

test("the migration locks the row and compares the revision BEFORE it syncs, and refuses without raising", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const body = /create\s+or\s+replace\s+function\s+public\.sync_workspace_if_revision\s*\(([\s\S]*?)\$function\$([\s\S]*?)\$function\$/i.exec(sql);
  assert.ok(body, "sync_workspace_if_revision is not defined in the migration");
  assert.match(body[1], /p_expected_revision\s+bigint/);
  const code = body[2].replace(/--[^\n]*/g, "");
  const lockAt = code.search(/from\s+public\.teacher_workspaces[\s\S]*?for\s+update/i);
  const compareAt = code.search(/is\s+distinct\s+from\s+p_expected_revision/i);
  const syncAt = code.search(/public\.sync_workspace\s*\(\s*p_teacher\s*,\s*p_data\s*\)/i);
  assert.ok(lockAt >= 0, "the teacher_workspaces row is not locked (select ... for update)");
  assert.ok(compareAt > lockAt, "the revision must be compared after the row is locked");
  assert.ok(syncAt > compareAt, "sync_workspace must run only after the revision check");
  assert.match(code.slice(compareAt, syncAt), /return\s+null/i, "a stale save must return null (409), not raise (500)");
  assert.doesNotMatch(code, /raise\s+exception/i, "a refused save must not raise -- that becomes a 500");
  assert.match(sql, /revoke\s+execute\s+on\s+function\s+public\.sync_workspace_if_revision\(uuid,\s*jsonb,\s*bigint\)\s+from\s+public,\s*anon,\s*authenticated/i, "only the service role may call it");
});
