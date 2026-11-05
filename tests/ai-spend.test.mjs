// AI spend detail (Ricky, 19 Oct 2026). Proven when:
//   - a 66-page class set -- 33 name checks and 11 grading calls, one a re-ask
//     -- reads as ONE item with its 66 pages, 44 calls and total cost;
//   - a long pause, a different test, another teacher or other work between
//     them starts a new item;
//   - the list reaches every call, paged, not the latest 50, and a page never
//     cuts a set in two;
//   - each kind of work on Usage and on a teacher's account opens its own
//     list, with date, test and cost.
// Made-up rows only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const S = bundle("lib/ai-spend.ts");

let n = 0;
const T0 = Date.parse("2026-10-20T03:00:00Z");
const row = (stage, secondsAfter, extra = {}) => ({
  id: "r" + ++n, teacher_id: "teacher-a", stage, status: "complete",
  created_at: new Date(T0 + secondsAfter * 1000).toISOString(), cost_usd: 0.002, assessment_id: null, charge_keys: null, ...extra,
});
/** A 66-page set as the app makes one: name checks every 2 pages, grading per 6 students (12 pages), and one re-ask. */
function classSet(at = 0, test = "test-1", teacher = "teacher-a") {
  const rows = [];
  for (let i = 0; i < 33; i++) rows.push(row("name_strip", at + i * 8, { teacher_id: teacher, assessment_id: i === 0 ? test : null }));
  for (let b = 0; b < 10; b++) {
    const pages = Array.from({ length: b < 4 ? 6 : 7 }, (_, k) => "page:" + teacher + ":" + test + ":" + (b < 4 ? b * 6 + k : 24 + (b - 4) * 7 + k));
    rows.push(row("class_scan", at + 300 + b * 20, { teacher_id: teacher, assessment_id: test, charge_keys: pages.slice(0, 12), cost_usd: 0.004 }));
  }
  rows.push(row("class_scan", at + 520, { teacher_id: teacher, assessment_id: test, charge_keys: ["page:" + teacher + ":" + test + ":3"], cost_usd: 0.004 }));
  return rows;
}
const newestFirst = (rows) => [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));

test("a 66-page class set reads as one set with its pages, calls and total", () => {
  const items = S.groupSpend(newestFirst(classSet()));
  assert.equal(items.length, 1);
  const [set] = items;
  assert.equal(set.kind, "set");
  assert.equal(set.pages, 66, "the re-ask's page is not counted twice");
  assert.equal(set.rows.length, 44);
  assert.equal(set.nameReads, 33);
  assert.equal(set.gradingCalls, 11);
  assert.equal(Math.round(set.cost * 1e4) / 1e4, Math.round((33 * 0.002 + 11 * 0.004) * 1e4) / 1e4);
  assert.equal(set.assessmentId, "test-1", "the test, from any call that names it");
});

test("a long pause, another test, another teacher or other work starts a new item", () => {
  const twoSets = S.groupSpend(newestFirst([...classSet(0, "test-1"), ...classSet(600 + S.SET_GAP_MS / 1000 + 60, "test-1")]));
  assert.equal(twoSets.length, 2, "more than 15 minutes apart");
  const otherTest = S.groupSpend(newestFirst([...classSet(0, "test-1"), ...classSet(560, "test-2")]));
  assert.equal(otherTest.filter((i) => i.kind === "set").length, 2, "a different test, even right after");
  const otherTeacher = S.groupSpend(newestFirst([row("class_scan", 0, { teacher_id: "teacher-b" }), row("class_scan", 5)]));
  assert.equal(otherTeacher.length, 2);
  const lesson = S.groupSpend(newestFirst([row("name_strip", 0), row("lesson", 5), row("class_scan", 10)]));
  assert.deepEqual(lesson.map((i) => i.kind), ["set", "call", "set"]);
  assert.equal(lesson[1].row.stage, "lesson");
});

/** A stand-in for the scans query: newest first, range(from, from+size-1). */
const fetcher = (rows) => {
  const sorted = newestFirst(rows);
  return async (from, size) => sorted.slice(from, from + size);
};

test("the list reaches every call, 50 items a page, not the latest 50", async () => {
  const rows = Array.from({ length: 130 }, (_, i) => row("lesson", i * 3600));
  const fetchRows = fetcher(rows);
  const seen = [];
  let from = 0;
  let pages = 0;
  while (from !== null) {
    const p = await S.spendPage(fetchRows, { from });
    pages++;
    for (const i of p.items) seen.push(i.row.id);
    assert.ok(p.items.length <= 50);
    from = p.next;
  }
  assert.equal(pages, 3);
  assert.equal(seen.length, 130);
  assert.equal(new Set(seen).size, 130, "every call once");
});

test("a page never cuts a set in two, even across the rows it fetches", async () => {
  // 49 lessons newer than a 44-call set, then 10 older lessons.
  const rows = [...Array.from({ length: 49 }, (_, i) => row("lesson", 100000 + i * 3600)), ...classSet(50000), ...Array.from({ length: 10 }, (_, i) => row("lesson", i * 60))];
  const first = await S.spendPage(fetcher(rows), { from: 0, chunk: 20 });
  assert.equal(first.items.length, 50);
  const set = first.items[49];
  assert.equal(set.kind, "set");
  assert.equal(set.rows.length, 44, "whole, though it was fetched over three requests");
  assert.equal(first.next, 49 + 44);
  const second = await S.spendPage(fetcher(rows), { from: first.next, chunk: 20 });
  assert.equal(second.items.length, 10);
  assert.equal(second.next, null);
});

test("each kind of work opens its list with date, test and cost; Recent scans groups sets too", () => {
  const usage = readFileSync("app/admin/usage/page.tsx", "utf8");
  assert.match(usage, /<Link href=\{spendHref\(\{ stage: r\.stage \}\)\}><strong>\{info\.label\}<\/strong><\/Link>/);
  const account = readFileSync("app/admin/accounts/[id]/page.tsx", "utf8");
  assert.match(account, /<Link href=\{spendHref\(\{ teacher: a\.teacher_id, stage: r\.stage \}\)\}>/);
  assert.match(account, /groupSpend\(okScans\)/);
  assert.match(account, /All AI spend, paged/);
  const page = readFileSync("app/admin/usage/spend/page.tsx", "utf8");
  assert.match(page, /<th>When<\/th>[\s\S]*<th>What<\/th>[\s\S]*<th>Test<\/th>[\s\S]*<th className="num">Cost<\/th>/);
  assert.match(page, /Older →/);
  const admin = readFileSync("lib/supabase-admin.ts", "utf8");
  assert.match(admin, /\.range\(from, from \+ size - 1\)/, "paged in the query, no fixed limit");
  assert.match(admin, /assessment_id, charge_keys, extract_model/, "Recent scans has what grouping needs");
  assert.equal(S.spendHref({ teacher: "t1", stage: "class_scan" }, { from: "50" }), "/admin/usage/spend?teacher=t1&stage=class_scan&from=50");
});

test("the spend page renders the 66-page set as one row with its test, pages, calls and total", async () => {
  const path = await import("node:path");
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const { build } = await import("esbuild");
  const stubbed = /^(@\/lib\/supabase-admin|next\/link)$/;
  const r = await build({
    entryPoints: ["app/admin/usage/spend/page.tsx"], bundle: true, platform: "node", format: "cjs", write: false, jsx: "automatic",
    external: ["react", "react-dom"],
    alias: { "server-only": path.resolve("tests/fixtures/empty-module.cjs") },
    plugins: [{ name: "stubs", setup: (b) => b.onResolve({ filter: stubbed }, (a) => ({ path: a.path, external: true })) }],
  });
  const items = S.groupSpend(newestFirst([...classSet(0, "test-1"), row("lesson", 4000)]));
  const stubs = {
    // Node-mode interop: the module itself is the default export.
    "next/link": ({ href, children }) => require("react").createElement("a", { href }, children),
    "@/lib/supabase-admin": { getSpendPage: async () => ({ items, next: 50, titles: new Map([["test-1", "Unit 3 quiz"]]), emails: new Map(), totalCalls: 45 }) },
  };
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, (id) => stubs[id] ?? require(id));
  const el = await m.exports.default({ searchParams: Promise.resolve({ teacher: "teacher-a", stage: "class_scan" }) });
  const html = require("react-dom/server").renderToStaticMarkup(el);
  const sets = html.match(/data-kind="set"/g) || [];
  assert.equal(sets.length, 1, "one row for the set");
  const sep = "(?:<!-- -->)?";
  assert.match(html, new RegExp(`<strong>Class set</strong> · ${sep}66${sep} page${sep}s${sep} · ${sep}44${sep} AI calls \\(${sep}33${sep} name check${sep}s${sep}, ${sep}11${sep} grading\\)`));
  assert.match(html, /title="exact: \$0\.1100"><strong>\$0\.11<\/strong>/, "the set's total");
  assert.match(html, /<td>Unit 3 quiz<\/td>/);
  assert.match(html, /<h1>Whole-class scans<\/h1>/);
  assert.match(html, /45(<!-- -->)? AI call/);
  assert.match(html, /href="\/admin\/usage\/spend\?teacher=teacher-a&amp;stage=class_scan&amp;from=50">Older →/);
});
