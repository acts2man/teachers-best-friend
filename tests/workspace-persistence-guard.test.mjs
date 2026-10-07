// A tripwire for the bug that keeps biting: a new field on a workspace type
// that nobody taught sync_workspace()/get_workspace_json() to persist. On the
// Supabase deployment those two functions map a FIXED set of columns, so any
// field they don't name is silently dropped on save and missing on reload
// (errorType from #84 and pointsPossible both shipped broken this way).
//
// This test lists, per workspace type, exactly the fields the two DB functions
// round-trip. If a type gains or loses a field, this test fails until you
// update BOTH functions (a migration) AND this list -- and prove the round trip
// with a rolled-back save/reload on production. See CLAUDE.md, "Workspace
// persistence".
//
// Types stored whole as a jsonb blob (Lesson, Resource) are exempt: every field
// round-trips by construction, so they are not listed here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("lib/teacher-types.ts", "utf8");

/** The fields each function persists, plus any deliberately client-only ones.
 * Keep this in lockstep with sync_workspace/get_workspace_json. */
const PERSISTED = {
  Classroom: ["id", "name", "grade", "framework", "demo"],
  Student: ["id", "classId", "name", "color", "evidence", "notes"],
  Evidence: ["id", "standard", "score", "date", "source", "assessmentId"],
  Question: [
    "id", "number", "text", "passage", "answer", "standard", "secondary",
    "skill", "dok", "costas", "alignment", "improvement", "confidence",
    "level", "reasoning", "verified", "excluded", "points",
  ],
  StudentResponse: [
    "id", "studentId", "questionId", "answer", "correct", "match",
    "misconception", "confidence", "verified", "errorType",
    // Writing only, via student_writing_scores.
    "rubricScore", "rubricReason",
    // Grade by question (20261008190000).
    "finalAnswer", "answerRegion", "suggestedErrorType",
  ],
  Assessment: [
    "id", "classId", "elaArea", "title", "subject", "grade", "framework",
    "createdAt", "status", "questions", "responses", "uploadIds", "source",
    "passage", "genre", "rubric", "targetStandards", "answerKeyUploadIds",
    "assignmentUploadIds", "studentUploadIds", "answerKeyVerified", "classIds",
    "pointsPossible", "studentOrder",
  ],
};

/** Fields on a workspace type that are intentionally NOT persisted. Add here,
 * with a reason, only for something genuinely derived/client-only. */
const CLIENT_ONLY = {};

/** Pull the field names out of `export type Name = { ... }`, ignoring comments. */
function fieldsOf(typeName) {
  const m = new RegExp(`export type ${typeName} = \\{([\\s\\S]*?)\\n\\};`).exec(src);
  assert.ok(m, `type ${typeName} not found in lib/teacher-types.ts`);
  const body = m[1]
    .replace(/\/\*\*[\s\S]*?\*\//g, "") // strip JSDoc blocks
    .replace(/\/\/[^\n]*/g, ""); // strip line comments
  const fields = [];
  for (const line of body.split("\n")) {
    const f = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:/.exec(line);
    if (f) fields.push(f[1]);
  }
  return fields;
}

for (const [typeName, persisted] of Object.entries(PERSISTED)) {
  test(`${typeName}: every field round-trips through sync_workspace/get_workspace_json`, () => {
    const declared = fieldsOf(typeName).sort();
    const accountedFor = [...persisted, ...(CLIENT_ONLY[typeName] || [])].sort();
    assert.deepEqual(
      declared,
      accountedFor,
      `\n${typeName} fields have drifted from what is persisted.\n` +
        `Declared in teacher-types.ts: ${declared.join(", ")}\n` +
        `Persisted (+client-only):     ${accountedFor.join(", ")}\n` +
        `A new field MUST be added to sync_workspace() AND get_workspace_json() ` +
        `(in a migration, proven with a rolled-back save/reload), then listed in ` +
        `PERSISTED here. If it is genuinely client-only, add it to CLIENT_ONLY with a reason. ` +
        `See CLAUDE.md "Workspace persistence".`,
    );
  });
}
