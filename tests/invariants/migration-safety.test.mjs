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

export function problems(files, from = RULE_STARTS) {
  const out = [];
  for (const { name, text } of files) {
    if (name.slice(0, 14) < from) continue;
    const sql = strip(text);
    if (!/^\s*set\s+(local\s+)?lock_timeout\s*(=|to)/im.test(text)) out.push(`${name}: no "set lock_timeout"`);
    for (const m of sql.matchAll(/\bdrop\s+(table|column|function|procedure|view|materialized\s+view|type|schema|index)\b[^;]*/gi))
      out.push(`${name}: ${m[0].replace(/\s+/g, " ").slice(0, 90)}`);
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

test("the check bites: the history before the rule fails it", () => {
  // 20260923170500 dropped the legacy create_scan; most older files never
  // set lock_timeout. Run from the start, the check must object.
  const old = problems(migrationFiles(), "00000000000000");
  assert.ok(old.some((p) => /drop function/i.test(p)), "a DROP FUNCTION in the history was not caught");
  assert.ok(old.some((p) => /no "set lock_timeout"/.test(p)), "a missing lock_timeout in the history was not caught");
});
