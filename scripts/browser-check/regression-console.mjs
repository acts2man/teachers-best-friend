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
const metrics = [
  { names: { piles: 26, correct: 23, wrongConfident: 1, unassigned: 2, rightSuggestion: 2, accuracy: 0.885 } },
  { answers: { readAccuracy: 0.912, groupAccuracy: 0.884, wronglyCorrect: 2, wronglyBlank: 0, unsure: 7, partsRead: 18, partsExpected: 24 } },
  { answers: { readAccuracy: 0.912, groupAccuracy: 0.884, wronglyCorrect: 2, wronglyBlank: 0, unsure: 7, partsRead: 18, partsExpected: 24 } },
  { answer_key: { items: 15, right: 14, accuracy: 0.933 } },
  { standards: { items: 15, right: 11, accuracy: 0.733 } },
];
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
      return ok(steps % 2 ? { status: "running", progress: "Grading: batch 3 of 5 (re-ask 1)" } : { status: i % 2 ? "passed" : "failed", metrics: metrics[i], costUsd: 0.021 });
    }
    if (b.action === "finish-run")
      return ok({ summary: { cases: 5, passed: 2, failed: 3, errors: 0, costUsd: 0.1043, perCase: cases.map((code, i) => ({ code, kind: kinds[i], status: i % 2 ? "passed" : "failed", metrics: metrics[i], costUsd: 0.021 })) } });
    return ok({});
  });
  const page = await ctx.newPage();
  // The 2.5s wait between steps is real; make it instant for the harness.
  await page.addInitScript(() => { const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, Math.min(ms ?? 0, 10), ...a); });
  await page.goto(BASE + "/__regression-harness");
  await page.getByRole("button", { name: "Run test cases" }).click();
  await page.getByText(/Last run: 2\/5 passed/).waitFor({ timeout: 15000 });
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
