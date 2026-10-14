// RULE: every field on a workspace type is named in BOTH sync_workspace (the
// save) and get_workspace_json (the reload). See docs/system-map.md, rule R2.
//
// The Supabase deployment does not store the workspace as a blob. The save
// writes a fixed, hand-written list of JSON keys into columns and the reload
// reads a fixed list back; a key either function leaves out is dropped on save
// or missing on reload, and the app looks perfect until a refresh. Shipped
// broken twice: response.errorType (#84, fixed by 20260930220000) and
// assessment.pointsPossible (same migration).
//
// tests/workspace-persistence-guard.test.mjs keeps a HAND-WRITTEN list of what
// is persisted, so it is only as true as whoever last edited it. This test
// reads the truth instead: it replays supabase/migrations to rebuild the two
// functions as the database has them (including the pg_get_functiondef patch
// migrations), pulls out every key each one writes and reads, and checks them
// against lib/teacher-types.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  currentDefinitions,
  declaredFields,
  jsonReads,
  migrationFiles,
  syncWrites,
} from "./lib/workspace-sql.mjs";

const types = readFileSync("lib/teacher-types.ts", "utf8");
const defs = currentDefinitions(migrationFiles());
const written = syncWrites(defs.sync_workspace);
const read = jsonReads(defs.get_workspace_json);

/**
 * Fields that are deliberately NOT round-tripped, each with the reason. Adding
 * a field here is a design decision: say why in the comment, and put it in
 * docs/system-map.md. "I forgot the migration" is not a reason.
 */
const NOT_PERSISTED = {
  Standard: {
    // skills, prerequisites, next, vocabulary, misconception, example, dok and
    // source were listed here as KNOWN DATA LOSS until 20261014160000 (gap
    // G11) saved them in standards.meta. officialCode is the California
    // catalog's own code for a built-in standard; built-ins are never saved
    // (they ship with the app), and a custom standard has no official code.
    officialCode: "both",
  },
};

const TYPES = ["Classroom", "Student", "Evidence", "Assessment", "Question", "StudentResponse", "Group", "Standard"];

for (const type of TYPES) {
  test(`${type}: every field is written by sync_workspace and read back by get_workspace_json`, () => {
    const allowed = NOT_PERSISTED[type] ?? {};
    const fields = declaredFields(types, type);
    assert.ok(fields.length > 2, `could not read the fields of ${type}`);
    const notWritten = fields.filter((f) => !written[type].has(f) && !["write", "both"].includes(allowed[f]));
    const notRead = fields.filter((f) => !read[type].has(f) && !["read", "both"].includes(allowed[f]));
    assert.deepEqual(
      { notWritten, notRead },
      { notWritten: [], notRead: [] },
      `\n${type} has fields the database does not round-trip.\n` +
        `  not saved by sync_workspace:        ${notWritten.join(", ") || "-"}\n` +
        `  not reloaded by get_workspace_json: ${notRead.join(", ") || "-"}\n` +
        `Add a migration that teaches BOTH functions the field (the pg_get_functiondef ` +
        `patch style of 20261013130000 is safest), prove it with a rolled-back ` +
        `save/reload, and update tests/workspace-persistence-guard.test.mjs. ` +
        `See CLAUDE.md "Workspace persistence" and docs/system-map.md rule R2.`,
    );
  });
}

test("the not-persisted allow-list holds no stale entries", () => {
  // An entry for a field that IS now round-tripped (or no longer exists)
  // would hide the next real gap under the same name.
  for (const [type, fields] of Object.entries(NOT_PERSISTED)) {
    const declared = declaredFields(types, type);
    for (const [f, side] of Object.entries(fields)) {
      assert.ok(declared.includes(f), `${type}.${f} is allow-listed but no longer declared`);
      if (side === "write" || side === "both")
        assert.ok(!written[type].has(f), `${type}.${f} is saved now: drop it from NOT_PERSISTED`);
      if (side === "read" || side === "both")
        assert.ok(!read[type].has(f), `${type}.${f} is reloaded now: drop it from NOT_PERSISTED`);
    }
  }
});

test("the parser sees the fields added by the newest patch migrations", () => {
  // Guards the guard: if the replay silently stopped applying patch-style
  // migrations, every check above could pass on an old body.
  for (const [type, field] of [["Question", "answerParts"], ["Question", "secondChoice"], ["StudentResponse", "gradedAlone"]]) {
    assert.ok(written[type].has(field), `${type}.${field} not found in the rebuilt sync_workspace`);
    assert.ok(read[type].has(field), `${type}.${field} not found in the rebuilt get_workspace_json`);
  }
});

test("sync_workspace deletes from exactly the tables docs/system-map.md lists (rule R1)", () => {
  // Every table here loses any row the save does not name. Adding one is a
  // change to rule R1: every caller of the save must then send all of it.
  const tables = [...new Set([...defs.sync_workspace.matchAll(/delete\s+from\s+public\.([a-z_]+)/gi)].map((m) => m[1]))].sort();
  assert.deepEqual(tables, [
    "assessment_questions",
    "assessments",
    "classes",
    "lessons",
    "resources",
    "standards",
    "student_evidence",
    "student_group_members",
    "student_groups",
    "student_responses",
    "student_writing_scores",
    "students",
  ]);
});
