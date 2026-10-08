#!/usr/bin/env node
/**
 * How often does the app work out a WRONG answer key, at which setting, and for
 * how much? Ricky's Algebra 2 worksheet came back with 3 of 15 answers wrong;
 * this measures that properly so pipeline_config can be chosen on numbers.
 *
 *   Replay stored reads (no API key needed):
 *     node scripts/key-benchmark.mjs --replay bench/rational-expressions-2026-10-07.json
 *
 *   Live (needs OPENAI_API_KEY; spends real money -- roughly $0.006 per luna
 *   read, more at higher effort, ~$0.10+ per read on sol):
 *     OPENAI_API_KEY=... node scripts/key-benchmark.mjs bench/manifest.json \
 *       --runs 5 --settings gpt-5.6-luna:low,gpt-5.6-luna:medium,gpt-5.6-luna:high,gpt-5.6-sol:low \
 *       --check gpt-5.6-luna:medium
 *
 * Each read uses the app's own prompt (buildPrompt, mode "assignment") and the
 * app's own request body (requestBody in lib/analyze-server.ts), so what is
 * measured is what production sends. Answers are scored with the same
 * comparison the app's key check uses (lib/math-answer.ts), which never treats
 * + and − as equal. With --check, each read's key is solved a second time with
 * the "key_check" prompt and the report adds how many wrong answers the check
 * flags, how many slip through, and how many right answers it flags anyway.
 *
 * The worksheets are the teacher's blank pages, never student work.
 */
import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);

function load(entry) {
  const r = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "error",
    tsconfig: path.join(ROOT, "tsconfig.json"),
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

/** USD per million tokens, from production's model_pricing (8 Oct 2026). */
const PRICES = {
  "gpt-5.6-sol": { in: 4.0, out: 20.0 },
  "gpt-5.6-terra": { in: 2.0, out: 12.0 },
  "gpt-5.6-luna": { in: 0.2, out: 1.2 },
  "gpt-5.4-mini": { in: 0.75, out: 4.5 },
  "gpt-5.4-nano": { in: 0.2, out: 1.25 },
};

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const { compareAnswers } = load("lib/math-answer.ts");

function score(keys, truth) {
  const wrong = [];
  for (const [n, expected] of Object.entries(truth)) {
    const got = keys[n];
    if (got === undefined || compareAnswers(got, expected) !== "same") wrong.push(n);
  }
  return { right: Object.keys(truth).length - wrong.length, total: Object.keys(truth).length, wrong };
}

function pct(a, b) {
  return b ? Math.round((100 * a) / b) + "%" : "-";
}

// ---------------------------------------------------------------- replay
if (args.includes("--replay")) {
  const file = flag("replay");
  const data = JSON.parse(readFileSync(file, "utf8"));
  let right = 0;
  let total = 0;
  let cost = 0;
  for (const run of data.runs) {
    const s = score(run.keys, data.truth);
    right += s.right;
    total += s.total;
    cost += run.cost ?? 0;
    console.log(
      (run.at ?? "").slice(11, 16).padEnd(6),
      (s.right + "/" + s.total).padEnd(6),
      "wrong: " + (s.wrong.map((n) => "Q" + n).join(", ") || "none"),
    );
  }
  console.log(
    `\n${data.setting ?? ""}: ${right}/${total} answers right (${pct(right, total)}) over ${data.runs.length} reads; ` +
      `avg $${(cost / Math.max(1, data.runs.length)).toFixed(4)} per read`,
  );
  // What a second, independent solve would have caught, using the other reads
  // of the same setting as stand-ins for the checker.
  let wrongN = 0;
  let caught = 0;
  let falseFlags = 0;
  let pairs = 0;
  for (const A of data.runs)
    for (const B of data.runs) {
      if (A === B) continue;
      pairs++;
      for (const [n, expected] of Object.entries(data.truth)) {
        const a = A.keys[n];
        const b = B.keys[n];
        const aRight = a !== undefined && compareAnswers(a, expected) === "same";
        const flagged = a === undefined || b === undefined || compareAnswers(a, b) === "different";
        if (!aRight) {
          wrongN++;
          if (flagged) caught++;
        } else if (flagged) falseFlags++;
      }
    }
  console.log(
    `checked by a second read of the same setting: ${caught}/${wrongN} wrong answers flagged (${pct(caught, wrongN)}); ` +
      `${((wrongN - caught) / pairs).toFixed(2)} wrong answers per exam left unflagged (was ${(wrongN / pairs).toFixed(1)}); ` +
      `${(falseFlags / pairs).toFixed(1)} right answers per exam flagged anyway`,
  );
  process.exit(0);
}

// ---------------------------------------------------------------- live
const manifestPath = args.find((a) => !a.startsWith("--") && a.endsWith(".json"));
if (!manifestPath) {
  console.error("Usage: see the comment at the top of scripts/key-benchmark.mjs");
  process.exit(64);
}
const key = process.env.OPENAI_API_KEY;
const dry = args.includes("--dry-run");
if (!key && !dry) {
  console.error("OPENAI_API_KEY is not set. Use --dry-run to see the plan, or --replay for stored reads.");
  process.exit(64);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const runs = Number(flag("runs", "3"));
const settings = flag("settings", "gpt-5.6-luna:low,gpt-5.6-luna:medium,gpt-5.6-sol:low")
  .split(",")
  .map((s) => {
    const [model, effort] = s.split(":");
    return { model, effort: effort || "low" };
  });
const checkSetting = flag("check", null);
const check = checkSetting
  ? { model: checkSetting.split(":")[0], effort: checkSetting.split(":")[1] || "medium" }
  : null;

const shared = load("lib/analyze-shared.ts");
const server = load("lib/analyze-server.ts");

function contentFor(files) {
  return files.map((f) => {
    const bytes = readFileSync(f);
    const b64 = bytes.toString("base64");
    return f.toLowerCase().endsWith(".pdf")
      ? { type: "input_file", filename: path.basename(f), file_data: "data:application/pdf;base64," + b64 }
      : {
          type: "input_image",
          image_url: "data:" + (f.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg") + ";base64," + b64,
          detail: "high",
        };
  });
}

async function call(setting, mode, prompt, images) {
  const body = server.requestBody(
    { model: setting.model, effort: setting.effort, maxOutput: mode === "assignment" ? 16000 : 12000 },
    [...images, { type: "input_text", text: prompt.task }],
    mode,
    prompt.schema,
    { store: false },
  );
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || "HTTP " + r.status);
  const text = d.output?.flatMap((o) => o.content ?? []).find((c) => c.type === "output_text")?.text ?? "{}";
  const price = PRICES[setting.model] ?? { in: 0, out: 0 };
  const u = d.usage ?? {};
  const cost = ((u.input_tokens ?? 0) * price.in + (u.output_tokens ?? 0) * price.out) / 1e6;
  return { out: JSON.parse(text), cost, status: d.status, usage: u };
}

const rows = [];
for (const sheet of manifest.worksheets) {
  const images = dry ? [] : contentFor(sheet.files);
  const catalog = sheet.standards.map((s) => ({
    subject: sheet.subject, grade: sheet.grade, framework: sheet.framework,
    summary: s.wording, skills: [], prerequisites: [], next: [], vocabulary: [],
    misconception: "", example: "", dok: 2, source: "", ...s,
  }));
  const workspace = { assessments: [], students: [], classes: [], lessons: [] };
  const params = shared.analyzeInput.parse({
    mode: "assignment", grade: sheet.grade, subject: sheet.subject, framework: sheet.framework,
    targetStandards: sheet.targetStandards, text: sheet.text ?? "", freshRead: true,
  });
  const readPrompt = shared.buildPrompt(params, workspace, catalog, true);
  for (const setting of settings) {
    const label = setting.model + ":" + setting.effort;
    if (dry) {
      console.log(`[dry-run] ${sheet.name} x ${runs} at ${label}${check ? " + check at " + check.model + ":" + check.effort : ""}`);
      continue;
    }
    for (let i = 0; i < runs; i++) {
      const read = await call(setting, "assignment", readPrompt, images);
      const keys = Object.fromEntries((read.out.questions ?? []).map((q) => [String(q.number), q.answer]));
      const s = score(keys, sheet.key);
      const row = { sheet: sheet.name, setting: label, ...s, cost: read.cost, status: read.status };
      if (check) {
        // The checker sees the questions as read, not the answers.
        const questions = (read.out.questions ?? []).map((q, j) => ({
          id: "q" + j, number: q.number, text: q.text, passage: q.passage ?? "", answer: q.answer,
          standard: "", secondary: "", skill: "", dok: 2, alignment: 0, confidence: 0,
          level: "On grade", reasoning: "", verified: true, excluded: false,
        }));
        const ws = {
          ...workspace,
          assessments: [{ id: "bench", questions, grade: sheet.grade, subject: sheet.subject }],
        };
        const cp = shared.buildPrompt(
          shared.analyzeInput.parse({ mode: "key_check", assessmentId: "bench", grade: sheet.grade, subject: sheet.subject, framework: sheet.framework }),
          ws, catalog, true,
        );
        const second = await call(check, "key_check", cp, images);
        const other = Object.fromEntries((second.out.answers ?? []).map((x) => [x.questionId, x.answer]));
        let caught = 0;
        let falseFlags = 0;
        for (const q of questions) {
          const n = String(q.number);
          const wrong = s.wrong.includes(n);
          const flagged = !other[q.id] || compareAnswers(q.answer, other[q.id]) === "different";
          if (wrong && flagged) caught++;
          if (!wrong && flagged) falseFlags++;
        }
        Object.assign(row, { caught, falseFlags, checkCost: second.cost });
      }
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
}
if (dry) process.exit(0);

console.log("\nsetting                      reads  answers right  worst read  avg $/exam" + (check ? "  wrong unflagged/exam  right flagged/exam  check $/exam" : ""));
for (const setting of settings) {
  const label = setting.model + ":" + setting.effort;
  const mine = rows.filter((r) => r.setting === label);
  if (!mine.length) continue;
  const right = mine.reduce((s, r) => s + r.right, 0);
  const total = mine.reduce((s, r) => s + r.total, 0);
  const worst = Math.min(...mine.map((r) => r.right / r.total));
  const cost = mine.reduce((s, r) => s + r.cost, 0) / mine.length;
  let tail = "";
  if (check) {
    const unflagged = mine.reduce((s, r) => s + (r.total - r.right - r.caught), 0) / mine.length;
    const ff = mine.reduce((s, r) => s + r.falseFlags, 0) / mine.length;
    const cc = mine.reduce((s, r) => s + r.checkCost, 0) / mine.length;
    tail = `  ${unflagged.toFixed(2).padStart(20)}  ${ff.toFixed(1).padStart(18)}  ${cc.toFixed(4).padStart(12)}`;
  }
  console.log(
    `${label.padEnd(28)} ${String(mine.length).padStart(5)}  ${(right + "/" + total + " " + pct(right, total)).padStart(13)}  ${pct(worst * 100, 100).padStart(10)}  ${cost.toFixed(4).padStart(10)}${tail}`,
  );
}
