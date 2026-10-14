// RULE R9: a database change can be applied to the live database safely:
// it never waits on a lock indefinitely (lock_timeout), and it never DROPs a
// table, column, function, view or type -- it patches in place, so applying
// it twice, or after someone else's change, cannot destroy data or revert a
// function. docs/system-map.md, rule R9.
//
// Why: migrations are applied BY HAND to production (supabase/migrations/
// README.md; each recent file says "NOT applied by the author"). A DDL
// statement queued behind a long transaction holds every later query on that
// table -- every teacher's save -- for as long as it waits. A
// `drop function` + `create function` pair, or a whole-body redefinition
// written against an old copy, silently reverts whatever changed in between
// (the README's security_invoker story; why 20261012200000 onward patch the
// live definition with pg_get_functiondef instead).
//
// Enforced from 20261012190000, the first migration written to this rule.
// Older files are history -- they ran as they are and are not edited.
import test from "node:test";
import assert from "node:assert/strict";
import { migrationFiles } from "./lib/workspace-sql.mjs";

export const RULE_STARTS = "20261012190000";

const strip = (sql) =>
  sql
    .replace(/--[^\n]*/g, "")
    // Dollar-quoted bodies are code that runs later, not DDL in this file.
    .replace(/\$([a-zA-Z_]*)\$[\s\S]*?\$\1\$/g, "");

// The ONLY exceptions to "no DROP", each one statement in one file, matched
// exactly (whitespace collapsed, lower-case). Adding an entry is a design
// decision: say why here and in docs/system-map.md rule R9. Never a table,
// column or function -- only an index, which holds no data and can be built
// again.
export const ALLOWED_DROPS = {
  // G8: custom standards were unique on (teacher_id, code), which rejects the
  // same code in two frameworks and failed every save of a teacher who loaded
  // California and Common Core. A unique index cannot be made non-unique
  // except by dropping it. The file builds the wider unique index and
  // re-points sync_workspace at it first, in the same transaction.
  "20261014130000_custom_standards_per_framework.sql": ["drop index if exists public.custom_standards_key"],
};

const normal = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();

export function problems(files, from = RULE_STARTS) {
  const out = [];
  for (const { name, text } of files) {
    if (name.slice(0, 14) < from) continue;
    const sql = strip(text);
    if (!/^\s*set\s+(local\s+)?lock_timeout\s*(=|to)/im.test(text)) out.push(`${name}: no "set lock_timeout"`);
    for (const m of sql.matchAll(/\bdrop\s+(table|column|function|procedure|view|materialized\s+view|type|schema|index)\b[^;]*/gi)) {
      if ((ALLOWED_DROPS[name] ?? []).includes(normal(m[0]))) continue;
      out.push(`${name}: ${m[0].replace(/\s+/g, " ").slice(0, 90)}`);
    }
    // DROP ... IF EXISTS of a policy or trigger is how Postgres re-creates
    // one (there is no CREATE OR REPLACE for them). Allowed only when the
    // same file creates it again under the same name.
    for (const m of sql.matchAll(/\bdrop\s+(policy|trigger)\s+(?:if\s+exists\s+)?("[^"]+"|[\w.]+)/gi)) {
      const recreate = new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?(?:constraint\\s+)?${m[1]}\\s+${m[2].replace(/[.*+?^${}()|[\]\\"]/g, "\\$&")}`, "i");
      if (!recreate.test(sql)) out.push(`${name}: drops ${m[1]} ${m[2]} without re-creating it`);
    }
  }
  return out;
}

test("every migration since the rule started sets lock_timeout and drops nothing", () => {
  assert.deepEqual(problems(migrationFiles()), []);
});

test("every allowed drop is an index, and is still in its file", () => {
  // A stale entry would quietly allow the same statement in a later edit.
  const byName = Object.fromEntries(migrationFiles().map((f) => [f.name, strip(f.text)]));
  for (const [file, statements] of Object.entries(ALLOWED_DROPS)) {
    assert.ok(byName[file] !== undefined, `${file} is allow-listed but does not exist`);
    for (const s of statements) {
      assert.match(s, /^drop index /, `${file}: only an index may be allow-listed: ${s}`);
      assert.ok(normal(byName[file]).includes(s), `${file}: allow-listed "${s}" is not in the file`);
    }
  }
});

test("the allow-list is exact: any other drop in the same file still fails", () => {
  const [file] = Object.keys(ALLOWED_DROPS);
  const fake = [{ name: file, text: "set lock_timeout = '5s';\ndrop index if exists public.standards_teacher_idx;\ndrop table public.standards;" }];
  assert.equal(problems(fake).length, 2);
});

test("the check bites: the history before the rule fails it", () => {
  // 20260923170500 dropped the legacy create_scan; most older files never
  // set lock_timeout. Run from the start, the check must object.
  const old = problems(migrationFiles(), "00000000000000");
  assert.ok(old.some((p) => /drop function/i.test(p)), "a DROP FUNCTION in the history was not caught");
  assert.ok(old.some((p) => /no "set lock_timeout"/.test(p)), "a missing lock_timeout in the history was not caught");
});
