// A retried call must charge a teacher exactly once.
//
// Retries were added on top of a metering system that was already live. The
// obvious way to get this wrong is to put the charge inside the retried unit,
// so a flaky afternoon at OpenAI quietly bills a class set two or three times
// and the teacher finds out from the meter.
//
// Two things make it safe, and both are checked here rather than assumed:
//
//   1. Structurally: the charge happens once, in create_scan (invoked via
//      startScan), before the model call, and withRetry wraps only the fetch.
//      The retry loop cannot reach the charge. The route no longer charges
//      directly -- enforcement moved into the database so no caller can skip it.
//   2. Even if it did: charge_pages is keyed on the sha256 of the page bytes
//      with a unique constraint, so a second charge for the same page is a
//      no-op. The database is the backstop, proved against production in
//      supabase/checks/page-charges.sql.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);

function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

const R = bundle("lib/ai-retry.ts");
const route = fs.readFileSync(path.join(ROOT, "app/api/analyze/route.ts"), "utf8");

test("the retried unit is the model call, and the charge sits outside it", async () => {
  // Simulates the route's shape: charge once, then retry the model call.
  let charges = 0;
  let modelCalls = 0;

  const chargePages = async () => {
    charges += 1;
  };
  const callModel = async () => {
    modelCalls += 1;
    if (modelCalls < 3) {
      const e = new R.AiCallError("server", 503, "openai sync 503: busy", 1);
      throw e;
    }
    return { id: "resp_ok" };
  };

  let t = 0;
  await chargePages();
  const out = await R.withRetry(callModel, {
    deadline: 120_000,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    random: () => 0.5,
  });

  assert.equal(out.attempts, 3, "the model was called three times");
  assert.equal(modelCalls, 3);
  assert.equal(charges, 1, "but the teacher was charged once");
});

test("the scan is opened (and charged) before the model call, not inside the retried unit", () => {
  // Structural, against the real file. create_scan performs the charge as it
  // opens the scan row, so startScan is the charge point; it must come before
  // either model path. If someone later moves it into the retried closure this
  // fails, which is the point.
  const startAt = route.indexOf("await startScan(");
  const syncAt = route.indexOf("await runModelSync(");
  const bgAt = route.indexOf("await startModelBackground(");
  assert.ok(startAt > 0, "startScan should be called in the route");
  assert.ok(syncAt > 0 && bgAt > 0, "both model paths should be in the route");
  assert.ok(startAt < syncAt, "startScan must come before the sync model call");
  assert.ok(startAt < bgAt, "startScan must come before the background start");
});

test("the route never charges directly -- the charge lives in create_scan", () => {
  // Enforcement moved into the database: a scan cannot exist uncharged because
  // create_scan is the only way to open one and it charges first. The route
  // calling chargePages itself would be a second, skippable path, which is the
  // shape of the bug this whole change removes.
  assert.ok(
    !route.includes("chargePages("),
    "the analyze route must not call chargePages -- create_scan charges",
  );
  const starts = route.split("await startScan(").length - 1;
  assert.equal(starts, 1, "there should be a single scan-open (and charge) call site");
});

test("the retry wrapper never touches the ledger", () => {
  const src = fs.readFileSync(path.join(ROOT, "lib/ai-retry.ts"), "utf8");
  // Comments stripped first: the file's own prose mentions Supabase to say it
  // does not use it, and matching that would be the assertion reading itself.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  // It is handed a function and a clock and nothing else. Importing nothing
  // means it cannot reach the ledger even by accident.
  assert.ok(
    !/^\s*import\s/m.test(code),
    "ai-retry should import nothing, so it stays testable and can never charge",
  );
  assert.ok(!/page-ledger|chargePages|createServiceClient/.test(code));
});

test("a failed run releases the pages once, in finally", () => {
  // settleCharge(false) releases; release_pages only ever touches an
  // unconfirmed reservation, so a retry that fails after an earlier batch
  // succeeded cannot claw back the pages that already graded.
  assert.ok(/const settleCharge = async \(ok: boolean\)/.test(route));
  assert.ok(/} finally \{\s*\n\s*await settleCharge\(ok\);/.test(route));
});

test("the attempt count is written to the scan row", () => {
  // So provider flakiness is a number we can look at rather than a feeling.
  assert.ok(/attempts: started\.attempts/.test(route), "background path records attempts");
  assert.ok(/\.update\(\{ attempts \}\)/.test(route), "sync path records attempts");
});
