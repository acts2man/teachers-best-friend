// Student work photos are kept 14 days after upload, then deleted (decided by
// both pilot founders, 14 Oct 2026; it was 30). Confirming grading deletes
// nothing early. This file proves the three things that have to agree:
//
//   1. the database: new uploads get 14 days, live ones are pulled in to 14
//      (the latest migration that sets the default is the one that counts);
//   2. the purge itself: run against uploads made 15 and 13 days ago, it
//      removes the 15-day-old file and keeps the 13-day-old one;
//   3. every published page and every in-app sentence says the same thing,
//      and none promises deletion on confirm any more.
//
// Nothing here touches a real database or bucket: the purge runs against an
// in-memory stand-in for the Supabase client.
import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync, readdirSync } from "node:fs";

const DAYS = 14;
const DAY_MS = 86_400_000;

// ---- 1. the database ------------------------------------------------------

const MIGRATIONS = "supabase/migrations";
const migrations = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

/** Days in the last migration that sets `table.expires_at`'s default. */
function defaultDays(table) {
  let days = null;
  for (const f of migrations) {
    const sql = readFileSync(`${MIGRATIONS}/${f}`, "utf8");
    const set = new RegExp(
      `alter table public\\.${table}\\s+alter column expires_at set default \\(now\\(\\) \\+ interval '(\\d+) days'\\)`,
      "g",
    );
    const add = new RegExp(`public\\.${table}\\b[\\s\\S]{0,200}?expires_at\\s+timestamptz not null default \\(now\\(\\) \\+ interval '(\\d+) days'\\)`, "g");
    for (const m of sql.matchAll(add)) days = Number(m[1]);
    for (const m of sql.matchAll(set)) days = Number(m[1]);
  }
  return days;
}

test("new uploads are kept 14 days: the latest default on both upload tables", () => {
  assert.equal(defaultDays("teacher_uploads"), DAYS);
  assert.equal(defaultDays("uploads"), DAYS);
});

test("the 14-day migration pulls live uploads in to 14 days and never lengthens or touches purged rows", () => {
  const f = migrations.find((m) => m.includes("photo_retention_14_days"));
  assert.ok(f, "migration present");
  const sql = readFileSync(`${MIGRATIONS}/${f}`, "utf8");
  assert.match(sql, /^set lock_timeout = '5s';/);
  assert.doesNotMatch(sql, /\bdrop\b/i);
  for (const table of ["teacher_uploads", "uploads"]) {
    const backfill = new RegExp(
      `update public\\.${table}\\s+set expires_at = created_at \\+ interval '${DAYS} days'\\s+where purged_at is null\\s+and expires_at > created_at \\+ interval '${DAYS} days';`,
    );
    assert.match(sql, backfill, table);
  }
});

// ---- 2. the purge ---------------------------------------------------------

/** The edge function, bundled with its two jsr imports swapped for stand-ins. */
async function loadPurge(fake) {
  const out = await build({
    entryPoints: ["supabase/functions/purge-expired-uploads/index.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    plugins: [{
      name: "jsr",
      setup(b) {
        b.onResolve({ filter: /^jsr:/ }, (a) => ({ path: a.path, namespace: "jsr" }));
        b.onLoad({ filter: /.*/, namespace: "jsr" }, (a) => ({
          contents: a.path.includes("supabase-js") ? "module.exports={createClient:(...x)=>globalThis.__fakeClient(...x)}" : "",
          loader: "js",
        }));
      },
    }],
  });
  let handler;
  globalThis.Deno = {
    env: { get: (k) => ({ SUPABASE_URL: "http://fake", SUPABASE_SERVICE_ROLE_KEY: "fake" })[k] },
    serve: (h) => { handler = h; },
  };
  globalThis.__fakeClient = () => fake;
  const shim = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(shim, shim.exports, () => ({}));
  return handler;
}

/** Enough of the Supabase client for the purge: one filtered select, one
 * update by id, and Storage remove(). */
function fakeSupabase(tables, bucket) {
  return {
    from(table) {
      const rows = tables[table];
      const q = { filters: [], lim: Infinity };
      const api = {
        select() { return api; },
        is(col, v) { q.filters.push((r) => (r[col] ?? null) === v); return api; },
        lte(col, v) { q.filters.push((r) => r[col] <= v); return api; },
        limit(n) { q.lim = n; return Promise.resolve({ data: rows.filter((r) => q.filters.every((f) => f(r))).slice(0, n), error: null }); },
        update(patch) {
          return { in(col, ids) { for (const r of rows) if (ids.includes(r[col])) Object.assign(r, patch); return Promise.resolve({ error: null }); } };
        },
      };
      return api;
    },
    storage: {
      from(name) {
        return { remove(paths) { for (const p of paths) bucket.delete(name + "/" + p); return Promise.resolve({ error: null }); } };
      },
    },
  };
}

/** A row as the database writes it: expires_at is created_at plus whatever
 * default the migrations leave on teacher_uploads (read from the files, not
 * assumed), so a 30-day default makes the 15-day row survive and this fails. */
const upload = (id, ageDays, now) => {
  const created = now - ageDays * DAY_MS;
  const keep = defaultDays("teacher_uploads");
  return { id, object_path: "t/" + id, created_at: new Date(created).toISOString(), expires_at: new Date(created + keep * DAY_MS).toISOString(), purged_at: null };
};

test("the purge removes a 15-day-old upload and keeps a 13-day-old one", async () => {
  const now = Date.now();
  const tables = { teacher_uploads: [upload("u15", 15, now), upload("u13", 13, now)], uploads: [] };
  const bucket = new Set(["teacher-documents/t/u15", "teacher-documents/t/u13"]);
  const handler = await loadPurge(fakeSupabase(tables, bucket));
  const res = await handler(new Request("http://fake/"));
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.teacher_uploads, { due: 1, deleted: 1 });
  assert.deepEqual([...bucket], ["teacher-documents/t/u13"], "only the 15-day file is gone");
  assert.ok(tables.teacher_uploads.find((r) => r.id === "u15").purged_at, "15-day row marked purged");
  assert.equal(tables.teacher_uploads.find((r) => r.id === "u13").purged_at, null, "13-day row untouched");
});

// ---- 3. what the pages and the app say -----------------------------------

const LEGAL = ["privacy", "how-we-use-ai", "student-data-privacy", "dpa"].map((p) => [p, readFileSync(`content/legal/${p}.md`, "utf8")]);
const IN_APP = ["components/teacher-planning.tsx", "lib/account-export.ts", "components/teacher-review.tsx"].map((p) => [p, readFileSync(p, "utf8")]);
const FLOW = readFileSync("docs/student-data-flow.md", "utf8");
const REPLAY = readFileSync("docs/regression-replay.md", "utf8");

test("every published page states 14 days after upload for student work photos", () => {
  for (const [name, md] of LEGAL) {
    assert.match(md, /deleted automatically 14 days after upload/i, name);
  }
  assert.match(FLOW, /\*\*14 days from upload\*\*/);
});

test("no page or screen still says 30 days for photos, or deletion on confirm", () => {
  const stale = [
    /30 days after upload/i,
    /30 days from upload/i,
    /(deleted|delete[sd]?)[^.|]{0,40}(as soon as|once|when) (you|the teacher) confirms?/i,
    /free up the photos/i,
    /deletion-on-confirm/i,
    /confirming[^.|]{0,60}\bdeletes\b(?!\s+(no|nothing)\b)/i,
    /30-day (image window|window|purge|clean-?up|retention)/i,
  ];
  for (const [name, text] of [...LEGAL, ...IN_APP, ["docs/student-data-flow.md", FLOW], ["docs/regression-replay.md", REPLAY]]) {
    for (const re of stale) assert.doesNotMatch(text, re, `${name}: ${re}`);
  }
});

test("the in-app download notes say 14 days", () => {
  for (const [name, text] of IN_APP.slice(0, 2)) assert.match(text, /14 days after upload/, name);
});

test("the effective date is filled in on the pages that changed", () => {
  for (const name of ["privacy", "how-we-use-ai", "student-data-privacy"]) {
    const md = LEGAL.find(([n]) => n === name)[1];
    assert.doesNotMatch(md, /Effective date: \[EFFECTIVE DATE\]/, name);
    assert.match(md, /Effective date: [A-Z][a-z]+ \d{1,2}, \d{4}/, name);
  }
  assert.doesNotMatch(LEGAL.find(([n]) => n === "dpa")[1], /Last updated: \[EFFECTIVE DATE\]/);
});
