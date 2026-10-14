// Rebuilds the CURRENT bodies of sync_workspace() and get_workspace_json() from
// supabase/migrations, the way the database got them, and says which JSON keys
// each one writes and reads.
//
// Two styles of migration change these functions, and both are replayed:
//   1. `create or replace function public.<fn>(...) ... $function$;` -- the whole
//      body is replaced (the last one wins).
//   2. The patch style (20261012200000 onward): a `do $patch$` block that reads
//      the live body with pg_get_functiondef and applies
//      `edits text[][] := array[ array['<fn>', '<fragment>', '<replacement>'], ...]`.
//      Each edit is skipped when the replacement is already present, and must
//      otherwise find its fragment exactly once -- the same rule the migration
//      enforces, so a patch that would raise on the database fails here too.
//
// Pure functions over file text, so a proof can feed it the migrations as they
// were at an older commit (`git show <sha>:<path>`).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const FUNCTIONS = ["sync_workspace", "get_workspace_json"];

/** Every migration in apply order (the timestamp prefix sorts lexically). */
export function migrationFiles(dir = "supabase/migrations") {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ name: f, text: readFileSync(path.join(dir, f), "utf8") }));
}

/** Unquote a SQL string literal body: '' -> '. */
const unquote = (s) => s.replace(/''/g, "'");

/** The `create or replace function public.<fn>` bodies in one file, in order. */
function fullDefinitions(text, fn) {
  const out = [];
  const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(`, "gi");
  let m;
  while ((m = re.exec(text))) {
    // The body sits between the first dollar-quote tag after the header and
    // the same tag closing it.
    const rest = text.slice(m.index);
    const tag = /(\$[a-zA-Z_]*\$)/.exec(rest);
    if (!tag) throw new Error(`${fn}: no dollar-quoted body after its header`);
    const open = rest.indexOf(tag[1]);
    const close = rest.indexOf(tag[1], open + tag[1].length);
    if (close < 0) throw new Error(`${fn}: unterminated body`);
    out.push(rest.slice(0, close + tag[1].length));
  }
  return out;
}

/** The [fn, fragment, replacement] edits of a patch-style migration. */
function patchEdits(text) {
  const block = /edits\s+text\[\]\[\]\s*:=\s*array\[([\s\S]*?)\];/i.exec(text);
  if (!block) return [];
  const edits = [];
  // One SQL literal: '...' with '' as the escaped quote.
  const lit = "'((?:[^']|'')*)'";
  const re = new RegExp(`array\\[\\s*${lit}\\s*,\\s*${lit}\\s*,\\s*${lit}\\s*\\]`, "g");
  let m;
  while ((m = re.exec(block[1]))) edits.push([unquote(m[1]), unquote(m[2]), unquote(m[3])]);
  if (!edits.length) throw new Error("a patch migration's edits array could not be parsed");
  return edits;
}

const count = (hay, needle) => hay.split(needle).length - 1;

/**
 * Replays `files` and returns { sync_workspace, get_workspace_json }: each the
 * function's current definition text. Throws, naming the migration, where a
 * patch would raise on the database.
 */
export function currentDefinitions(files) {
  const defs = {};
  for (const { name, text } of files) {
    for (const fn of FUNCTIONS) {
      const full = fullDefinitions(text, fn);
      if (full.length) defs[fn] = full[full.length - 1];
    }
    for (const [fn, fragment, replacement] of patchEdits(text)) {
      if (!FUNCTIONS.includes(fn)) continue;
      if (!defs[fn]) throw new Error(`${name}: patches ${fn} before any definition of it`);
      if (defs[fn].includes(replacement)) continue; // already applied
      const hits = count(defs[fn], fragment);
      if (hits !== 1)
        throw new Error(`${name}: ${fn} fragment found ${hits} times, expected 1: ${fragment}`);
      defs[fn] = defs[fn].replace(fragment, () => replacement);
    }
  }
  for (const fn of FUNCTIONS) if (!defs[fn]) throw new Error(`no definition of ${fn} found`);
  return defs;
}

/** Strip `-- ...` comments so a commented-out key never counts. */
const noComments = (sql) => sql.replace(/--[^\n]*/g, "");

/**
 * sync_workspace is written in sections headed `-------- <name>`. Returns
 * { <name>: sectionText }, names lower-cased.
 */
function syncSections(def) {
  const out = {};
  const re = /-{20,}\s*([^\n]+)\n/g;
  const heads = [];
  let m;
  while ((m = re.exec(def))) heads.push({ name: m[1].trim().toLowerCase(), at: m.index + m[0].length });
  heads.forEach((h, i) => {
    out[h.name] = def.slice(h.at, i + 1 < heads.length ? heads[i + 1].at : undefined);
  });
  return out;
}

/** JSON keys read off `alias` in `sql`: alias->>'key' and alias->'key'. */
function keysRead(sql, alias) {
  const keys = new Set();
  const re = new RegExp(`\\b${alias}\\s*->>?\\s*'([A-Za-z_][A-Za-z0-9_]*)'`, "g");
  let m;
  while ((m = re.exec(noComments(sql)))) keys.add(m[1]);
  return keys;
}

/** Which sync_workspace sections write each workspace type, and its alias. */
const SYNC_MAP = {
  Classroom: [["classes", "c"]],
  Student: [["students", "s"], ["evidence (nested in students)", "s"]],
  Evidence: [["evidence (nested in students)", "e"]],
  Assessment: [["assessments", "a"], ["questions", "a"], ["responses", "a"], ["writing rubric scores", "a"]],
  Question: [["questions", "q"]],
  StudentResponse: [["responses", "r"], ["writing rubric scores", "r"]],
  Group: [["groups", "g"]],
  Standard: [["custom standards", "cs"]],
};

/** { Type: Set(keys sync_workspace reads from the saved JSON) } */
export function syncWrites(def) {
  const sections = syncSections(def);
  const out = {};
  for (const [type, parts] of Object.entries(SYNC_MAP)) {
    out[type] = new Set();
    for (const [i, [section, alias]] of parts.entries()) {
      const body = sections[section];
      // The type's own section must exist; the others (writing scores came
      // later) only add keys when present.
      if (body === undefined && i === 0) throw new Error(`sync_workspace has no "${section}" section`);
      if (body === undefined) continue;
      for (const k of keysRead(body, alias)) out[type].add(k);
    }
  }
  return out;
}

/** The text between two markers, the first required, the second optional. */
function between(sql, from, to) {
  const i = sql.indexOf(from);
  if (i < 0) throw new Error(`get_workspace_json: marker not found: ${from}`);
  const j = to ? sql.indexOf(to, i + from.length) : -1;
  return sql.slice(i, j < 0 ? undefined : j);
}

/** Keys a jsonb_build_object emits in `sql`: 'key', <expr>. */
function keysEmitted(sql) {
  const keys = new Set();
  const re = /'([A-Za-z_][A-Za-z0-9_]*)'\s*,/g;
  let m;
  while ((m = re.exec(noComments(sql)))) keys.add(m[1]);
  return keys;
}

/** { Type: Set(keys get_workspace_json hands back to the app) } */
export function jsonReads(def) {
  const body = noComments(def);
  const top = between(body, "'classes', coalesce(");
  const students = between(top, "'students', coalesce(", "'assessments', coalesce(");
  const assessments = between(top, "'assessments', coalesce(", "'lessons', coalesce(");
  const assessmentOwn = between(assessments, "'assessments', coalesce(", "'questions', coalesce(");
  const questions = between(assessments, "'questions', coalesce(", "'responses', coalesce(");
  const responses = between(assessments, "'responses', coalesce(");
  const own = keysEmitted(assessmentOwn);
  own.add("questions");
  own.add("responses");
  const std = between(body, "std as (", "ws as (");
  return {
    Classroom: keysEmitted(between(top, "'classes', coalesce(", "'students', coalesce(")),
    Student: (() => {
      const s = keysEmitted(between(students, "'students', coalesce(", "'evidence', coalesce("));
      s.add("evidence");
      return s;
    })(),
    Evidence: keysEmitted(between(students, "'evidence', coalesce(")),
    Assessment: own,
    Question: keysEmitted(questions),
    StudentResponse: keysEmitted(responses),
    Group: keysEmitted(between(top, "'groups', coalesce(", "'customStandards', coalesce(")),
    Standard: keysEmitted(std),
  };
}

/** Field names of `export type Name = { ... }` in lib/teacher-types.ts. */
export function declaredFields(typesSource, typeName) {
  const m = new RegExp(`export type ${typeName} = \\{([\\s\\S]*?)\\n\\};`).exec(typesSource);
  if (!m) throw new Error(`type ${typeName} not found in lib/teacher-types.ts`);
  // Only top-level fields: nested object types (Lesson.custom) are skipped by
  // tracking brace depth.
  const body = m[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const fields = [];
  let depth = 0;
  for (const line of body.split("\n")) {
    const f = depth === 0 && /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:/.exec(line);
    if (f) fields.push(f[1]);
    depth += (line.match(/[{[]/g) || []).length - (line.match(/[}\]]/g) || []).length;
  }
  return fields;
}
