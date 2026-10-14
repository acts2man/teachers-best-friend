// RULE R14: one save never holds two rows for the same database key -- and the
// database key of a custom standard must be the key the app treats as one
// standard. docs/system-map.md, gap G8.
//
// The catalog loader (components/teacher-classes.tsx) keeps a standard per
// framework + grade + subject + code, and California and Common Core share
// codes (3.OA.A.1). While custom standards were unique on (teacher_id, code)
// and upserted `on conflict (teacher_id, code)`, a teacher who loaded both
// frameworks sent two rows with one code and EVERY save failed with "ON
// CONFLICT DO UPDATE command cannot affect row a second time".
//
// These checks read the migrations, the way workspace-field-round-trip does:
// they rebuild sync_workspace from supabase/migrations (patch migrations
// included) and replay every index created, dropped or renamed on
// public.standards.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { currentDefinitions, customStandardsSave, liveIndexes, migrationFiles } from "./lib/workspace-sql.mjs";

const files = migrationFiles();
const save = customStandardsSave(currentDefinitions(files).sync_workspace);
const teacherUnique = liveIndexes(files, "standards").filter(
  (i) => i.unique && /teacher_id\s+is\s+not\s+null/.test(i.where),
);
// The fields that make two catalog rows different standards to the app.
const IDENTITY = ["framework", "grade", "subject", "code"];

test("the custom-standards upsert is keyed on framework, grade, subject and code", () => {
  assert.deepEqual(
    [...save.conflictTarget].sort(),
    ["teacher_id", ...IDENTITY].sort(),
    `sync_workspace upserts custom standards on (${save.conflictTarget.join(", ")}); two frameworks sharing a code then fail every save`,
  );
});

test("no unique index on teacher rows is narrower than the standard's identity", () => {
  // A unique index on (teacher_id, code) alone rejects the second framework's
  // row whatever the ON CONFLICT target says.
  assert.ok(teacherUnique.length > 0, "no unique index on custom standards found at all");
  for (const idx of teacherUnique) {
    const missing = IDENTITY.filter((c) => !idx.columns.includes(c));
    assert.deepEqual(missing, [], `unique index ${idx.name} (${idx.columns.join(", ")}) leaves out ${missing.join(", ")}`);
  }
});

test("the upsert's ON CONFLICT target is a live unique index", () => {
  // Otherwise Postgres refuses the statement ("no unique or exclusion
  // constraint matching the ON CONFLICT specification") and every save fails.
  const target = [...save.conflictTarget].sort().join(",");
  assert.ok(
    teacherUnique.some((i) => [...i.columns].sort().join(",") === target),
    `no live unique index on (${save.conflictTarget.join(", ")}) where teacher_id is not null`,
  );
});

test("one save cannot send the same custom standard twice (R14)", () => {
  // The client never does, but if it did the save keeps one row instead of
  // failing: the insert reads from a DISTINCT ON over the same four fields.
  const m = /distinct\s+on\s*\(([\s\S]*?)\)\s*el\.v/i.exec(save.sql);
  assert.ok(m, "the custom-standards insert does not de-duplicate its payload");
  for (const k of IDENTITY) assert.ok(m[1].includes(`'${k}'`), `the de-duplication leaves out ${k}`);
});

test("removing a custom standard deletes only that framework's row", () => {
  // A delete by code alone would keep a stale row in one framework, or (with
  // the key the wrong way round) delete the other framework's.
  for (const k of IDENTITY)
    assert.match(save.deleteStatement, new RegExp(`'${k}'`), `the custom-standards delete does not match on ${k}`);
});

test("the client's catalog loader de-duplicates on the same identity", () => {
  // If the loader stopped filtering by subject or grade, it could send a row
  // the database treats as the same standard. Pinned so a change here is a
  // change to this key too.
  const src = readFileSync("components/teacher-classes.tsx", "utf8");
  assert.match(
    src,
    /x\.framework === framework && x\.grade === grade && x\.subject === s\)\s*\.map\(\(x\) => x\.code\)/,
  );
});

// ---------------------------------------------------------------------------
// G11 follow-up: the teacher's saved extras must not freeze the defaults.
//
// get_workspace_json and lib/teacher-server.ts normalizeStandard fill every
// missing extra (skills [], dok 2, a stock misconception and example), and the
// client sends them straight back. If the save stored them, the first save
// after 20261014130000 would write the defaults into every teacher row, and a
// row with meta never saw the shared catalog's later enrichment again.
const defs = currentDefinitions(files);
const stdCte = (() => {
  const body = defs.get_workspace_json;
  const i = body.indexOf("std as (");
  return body.slice(i, body.indexOf("ws as (", i));
})();
const sqlLit = (s) => `'${s.replace(/'/g, "''")}'`;

test("the reload merges the catalog's meta under the teacher's, key by key", () => {
  // catalog || teacher: the teacher's keys win, the catalog fills the rest. A
  // plain coalesce(teacher, catalog) hides the whole catalog once the teacher
  // row has any meta at all.
  assert.match(
    stdCte,
    /\(select g\.meta from public\.standards g[\s\S]*?limit 1\),\s*'\{\}'::jsonb\)\s*\|\|\s*coalesce\(s\.meta,\s*'\{\}'::jsonb\)/,
    "get_workspace_json does not merge the shared catalog's meta under the teacher's",
  );
});

test("the save keeps no empty list: an empty one would hide the catalog's", () => {
  for (const k of ["skills", "prerequisites", "next", "vocabulary"])
    assert.ok(
      save.sql.includes(`jsonb_array_length(cs->'${k}') > 0`),
      `sync_workspace stores an empty ${k} list in meta`,
    );
});

test("the save drops the stock texts and DOK the reader fills in itself", () => {
  const server = readFileSync("lib/teacher-server.ts", "utf8");
  const normalize = server.slice(server.indexOf("function normalizeStandard"), server.indexOf("export function normalizeWorkspace"));
  const fromClient = {
    misconception: /misconception:\s*item\.misconception\s*\?\?\s*"([^"]+)"/.exec(normalize)?.[1],
    example: /example:\s*item\.example\s*\?\?\s*"([^"]+)"/.exec(normalize)?.[1],
  };
  const unquote = (s) => s.replace(/''/g, "'");
  const fromReader = {
    misconception: /'misconception', coalesce\(m\.meta ->> 'misconception',\s*'((?:[^']|'')*)'\)/.exec(stdCte)?.[1],
    example: /'example', coalesce\(m\.meta ->> 'example',\s*'((?:[^']|'')*)'\)/.exec(stdCte)?.[1],
  };
  for (const k of ["misconception", "example"]) {
    assert.ok(fromClient[k] && fromReader[k], `could not read the default ${k} from normalizeStandard and get_workspace_json`);
    for (const text of new Set([fromClient[k], unquote(fromReader[k])]))
      assert.ok(save.sql.includes(sqlLit(text)), `sync_workspace stores the stock ${k} "${text}" in meta`);
  }
  // DOK: the reader's default is 2 (both places); the save leaves a 2 out.
  assert.match(stdCte, /'dok', coalesce\(public\.safe_int\(m\.meta ->> 'dok'\), 2\)/);
  assert.match(normalize, /typeof item\.dok === "number" \? item\.dok : 2/);
  assert.ok(save.sql.includes("nullif(public.safe_int(cs->>'dok'), 2)"), "sync_workspace stores the default DOK 2 in meta");
});
