// Only a failed other VERSION of a Generate gives its credit back (review of
// #199). Proven when, in a scratch Postgres, migrations 20261105120000 and
// 20261106120000 apply and the hand-run check
// supabase/checks/refund-lesson-generation.sql reports exactly what it
// expects: a run whose flow failed is refunded once; one whose only failure
// is an Add question is NOT; a run that worked, an unknown run, another
// teacher's and one older than 2 hours are not. The tables are the two the
// function reads, with the columns it uses (no data). Made-up ids only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startScratchPg } from "./helpers/scratch-pg.mjs";

const SCHEMA = `
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create table public.scans (id uuid primary key, teacher_id uuid not null, stage text, status text not null,
  billable boolean not null default true, params jsonb, created_at timestamptz not null default now());
create table public.page_charges (id uuid primary key default gen_random_uuid(), teacher_id uuid not null,
  upload_id uuid, content_sha256 text not null, pages integer not null, mode text not null,
  reserved_at timestamptz not null default now(), confirmed_at timestamptz, released_at timestamptz);
`;

let pg;
test.before(() => {
  pg = startScratchPg();
  const r = pg.sql(SCHEMA);
  assert.ok(r.ok, r.err);
});
test.after(() => pg?.stop());

function runCheck() {
  const dir = mkdtempSync(join(tmpdir(), "refund-check-"));
  chmodSync(dir, 0o755);
  const file = join(dir, "check.sql");
  writeFileSync(
    file,
    readFileSync("supabase/checks/refund-lesson-generation.sql", "utf8").replace(
      "'00000000-0000-0000-0000-000000000000'",
      "'22222222-2222-4222-8222-222222222222'",
    ),
  );
  chmodSync(file, 0o644);
  try {
    pg.file(file);
    return "";
  } catch (e) {
    return String(e.message);
  }
}

test("both migrations apply, and the check reports only a failed version refunds", () => {
  pg.file("supabase/migrations/20261105120000_refund_lesson_generation.sql");
  pg.file("supabase/migrations/20261106120000_refund_only_on_failed_version.sql");
  const out = runCheck();
  const m = /ROLLED_BACK expect (.*?) \| got ([\d ]+)/.exec(out);
  assert.ok(m, out);
  assert.equal(m[2].trim(), "1 0 0 0 0 0 0 1", m[1]);
});

test("the earlier rule (any failed request) refunded a failed Add question too", () => {
  pg.file("supabase/migrations/20261105120000_refund_lesson_generation.sql");
  const m = /got ([\d ]+)/.exec(runCheck());
  assert.ok(m);
  const got = m[1].trim().split(" ").map(Number);
  assert.equal(got[6], 1, "failed_question_only refunded under the old function");
  // And back to the fixed one for anything after.
  pg.file("supabase/migrations/20261106120000_refund_only_on_failed_version.sql");
});
