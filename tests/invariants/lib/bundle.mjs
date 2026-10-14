// Loads a lib/*.ts module the way the rest of the suite does: bundled with
// esbuild into CommonJS and evaluated, so a test exercises the real code with
// no build step. `alias` maps an import to a stub for modules that need a
// server (next/headers, Supabase clients).
import path from "node:path";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);

export function bundle(entry, alias = {}) {
  const r = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    absWorkingDir: ROOT,
    alias: {
      "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs"),
      ...Object.fromEntries(Object.entries(alias).map(([k, v]) => [k, path.join(ROOT, v)])),
    },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

/** A small seeded PRNG (mulberry32), so a failing fuzz case can be replayed
 * from the seed printed in the assertion message. */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    chance: (p) => next() < p,
    shuffle: (xs) => {
      const out = xs.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

/** How many fuzz cases to run. FUZZ_RUNS=5000 for a deeper local soak. */
export const RUNS = Number(process.env.FUZZ_RUNS) || 300;
