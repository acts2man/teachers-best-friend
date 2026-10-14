// The replay page's console (components/admin/regression-console.tsx) at three
// sizes. The real page needs a signed-in, allow-listed admin, which this harness
// cannot be, so the component itself is bundled and mounted, and its one API
// (/api/admin/regression) answers with demo numbers. It shows layout only:
// that a full run's results fit on a phone without overlap or sideways scroll.
import { chromium } from "playwright";
import { buildSync } from "esbuild";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const js = buildSync({
  stdin: {
    contents: `import { createRoot } from "react-dom/client"; import { RegressionConsole } from "./components/admin/regression-console.tsx"; createRoot(document.getElementById("root")).render(<RegressionConsole />);`,
    resolveDir: REPO,
    loader: "tsx",
  },
  bundle: true,
  format: "iife",
  jsx: "automatic",
  write: false,
  define: { "process.env.NODE_ENV": '"production"' },
  absWorkingDir: REPO,
}).outputFiles[0].text;

const cases = ["case-k3m9q2", "case-p7x1w4", "case-a8d2n5", "case-r4t6y0", "case-z9c3v8"];
const kinds = ["names", "answer_reading", "grouping", "answer_key", "standards"];

// The numbers shown come from the REAL scoring code run on made-up students,
// so every field the console reads exists under its current name, and
// "passed" is whatever the real pass rule says (#124 review: a hand-written
// mock showed "undefined" fields and a "passed" case with 2 wrongly correct,
// which the rule forbids).
const scoreMod = (() => {
  const out = buildSync({ entryPoints: [join(REPO, "lib/regression/score.ts")], bundle: true, platform: "node", format: "cjs", write: false, absWorkingDir: REPO }).outputFiles[0].text;
  const m = { exports: {} };
  new Function("module", "exports", out)(m, m.exports);
  return m.exports;
})();
const ids = Array.from({ length: 26 }, (_, i) => "s" + i);
const piles = ids.map((studentId) => ({ studentId, pages: ["p-" + studentId], strips: ["n-" + studentId] }));
const namesScore = scoreMod.scoreNames(
  piles,
  ids.map((id, i) => (i < 24 ? { studentId: id, suggestedId: null } : { studentId: null, suggestedId: i === 24 ? id : null })),
);
const expected = ids.flatMap((studentId) => ["q1", "q2"].map((questionId) => ({ studentId, questionId, finalAnswer: questionId === "q1" ? "12" : "3/4", answer: "", match: 100, verified: true })));
const response = (e, over = {}) => ({ id: e.studentId + e.questionId, studentId: e.studentId, questionId: e.questionId, answer: e.finalAnswer, finalAnswer: e.finalAnswer, correct: true, match: 100, confidence: 100, verified: false, misconception: "", ...over });
// Reading: two answers the model was unsure of -- passes the rule.
const readingScore = scoreMod.scoreAnswers(expected, expected.map((e, i) => response(e, i < 2 ? { correct: false, match: undefined, confidence: 0 } : {})), "answer_reading");
// Grouping: one answer the teacher gave half credit that the replay marked
// correct -- a wrongly-correct, which fails the rule whatever the accuracy.
const halfCredit = expected.map((e, i) => (i === 5 ? { ...e, match: 50 } : e));
const groupingScore = scoreMod.scoreAnswers(halfCredit, expected.map((e) => response(e)), "grouping");
// Key: one wrong number, and one made-up description in other words -- a
// human check, shown side by side (the widest thing on the page).
const DESCRIBED = "Increasing curve that passes through (0,1) and (1,3); domain all reals; horizontal asymptote along the x-axis";
const keyScore = scoreMod.scoreKey(
  Array.from({ length: 10 }, (_, i) => ({ number: i + 1, answer: i === 0 ? DESCRIBED : String(i + 1) })),
  Array.from({ length: 10 }, (_, i) => ({ number: i + 1, answer: i === 0 ? "Sketch a rising curve through (0,1) and (1,3); the domain is all real numbers and it never touches the x-axis" : String(i === 3 ? 99 : i + 1) })),
);
const standardsScore = scoreMod.scoreStandards(
  Array.from({ length: 10 }, (_, i) => ({ number: i + 1, standard: "7.RP.3" })),
  Array.from({ length: 10 }, (_, i) => ({ number: i + 1, standard: i < 9 ? "7.RP.3" : "" })),
);
const metrics = [{ names: namesScore }, { answers: readingScore }, { answers: groupingScore }, { answer_key: keyScore }, { standards: standardsScore }];
const statusOf = (i) => (Object.values(metrics[i])[0].passed ? "passed" : "failed");
const passedCount = cases.filter((_, i) => statusOf(i) === "passed").length;

let steps = 0;

const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);
const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [w, h] of [[390, 844], [412, 915], [1366, 768]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.route(BASE + "/__regression-harness", (r) =>
    r.fulfill({ contentType: "text/html", body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div><script>${js}</script>` }));
  await ctx.route("**/api/admin/regression", async (r) => {
    const b = JSON.parse(r.request().postData());
    const ok = (d) => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
    if (b.action === "summary") return ok({ cases: cases.map((code, i) => ({ code, kind: kinds[i], active: true })), runs: [] });
    if (b.action === "start-run") return ok({ runId: "00000000-0000-4000-8000-000000000001", cases });
    if (b.action === "step") {
      steps++;
      const i = cases.indexOf(b.caseCode);
      return ok(steps % 2 ? { status: "running", progress: "Grading: batch 3 of 5 (re-ask 1)" } : { status: statusOf(i), metrics: metrics[i], costUsd: 0.021 });
    }
    if (b.action === "finish-run")
      return ok({ summary: { cases: 5, passed: passedCount, failed: 5 - passedCount, errors: 0, costUsd: 0.1043, perCase: cases.map((code, i) => ({ code, kind: kinds[i], status: statusOf(i), metrics: metrics[i], costUsd: 0.021 })) } });
    return ok({});
  });
  const page = await ctx.newPage();
  // The 2.5s wait between steps is real; make it instant for the harness.
  await page.addInitScript(() => { const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, Math.min(ms ?? 0, 10), ...a); });
  await page.goto(BASE + "/__regression-harness");
  await page.getByRole("button", { name: "Run test cases" }).click();
  await page.getByText(new RegExp(`Last run: ${passedCount}\\/5 passed`)).waitFor({ timeout: 15000 });
  const text = await page.locator("body").innerText();
  check(!/\bundefined\b|\bNaN\b/.test(text), `${w}x${h}: no "undefined" or "NaN" on the page`);
  check(text.includes("9/10 count toward the pass mark (8 confirmed, 1 needs a human check); wrong: Q4"), `${w}x${h}: the key line names the human check and the miss`);
  check(text.includes("Needs a human check (not counted as a miss)") && text.includes(DESCRIBED), `${w}x${h}: the human check is shown side by side`);
  await page.screenshot({ path: join(OUT, `regression-console-${w}x${h}.png`), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(!overflow, `${w}x${h}: no sideways scroll`);
  const btn = await page.getByRole("button", { name: "Run test cases" }).boundingBox();
  check(btn && btn.x >= 0 && btn.x + btn.width <= w, `${w}x${h}: Run button fully on screen`);
  await ctx.close();
}
await browser.close();
for (const p of pass) console.log("  OK   " + p);
for (const f of fail) console.log("  FAIL " + f);
process.exit(fail.length ? 1 : 0);
