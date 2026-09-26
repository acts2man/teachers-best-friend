// The reasoning effort sent to the AI provider must be one the models accept.
//
// "minimal" was valid on the gpt-5 generation the app began on; every model it
// routes to now (gpt-5.4-nano, gpt-5.6-luna, ...) rejects it with a 400 and
// takes the whole request down. That 400 is what broke the class-scan name pass
// for a pilot teacher: the name_strip stage was set to "minimal", so reading
// the names off a scanned stack failed before any grading could start, and the
// teacher was told only that the pages couldn't be read.
//
// providerEffort is the single guard that rewrites any lingering "minimal" to a
// value the models still accept, so no pipeline_config row, admin edit, or
// fixed Sites route can send the dead value again.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import path from "node:path";

const ROOT = process.cwd();
const result = buildSync({
  entryPoints: ["lib/analyze-shared.ts"],
  bundle: true, platform: "node", format: "cjs", write: false,
  absWorkingDir: ROOT,
  alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
});
const shim = { exports: {} };
new Function("module", "exports", result.outputFiles[0].text)(shim, shim.exports);
const { providerEffort } = shim.exports;

// The values gpt-5.4-nano and gpt-5.6-luna accept for reasoning.effort. Copied
// verbatim from the provider's own 400 message; "minimal" is deliberately not
// here, which is the whole point.
const ACCEPTED = new Set(["none", "low", "medium", "high", "xhigh"]);

test("minimal is rewritten to a value the models accept", () => {
  assert.equal(providerEffort("minimal"), "low");
  assert.ok(ACCEPTED.has(providerEffort("minimal")));
});

test("every other effort passes through untouched", () => {
  for (const effort of ["none", "low", "medium", "high"]) {
    assert.equal(providerEffort(effort), effort);
  }
});

test("no configured effort can ever reach the provider as 'minimal'", () => {
  // Whatever a stage is set to -- including the one value that 400s -- what
  // leaves for the provider is always in the accepted set.
  for (const effort of ["none", "minimal", "low", "medium", "high"]) {
    assert.ok(
      ACCEPTED.has(providerEffort(effort)),
      `${effort} -> ${providerEffort(effort)} is not accepted by the models`,
    );
  }
});
