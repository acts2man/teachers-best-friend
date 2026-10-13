// #125 follow-up c (13 Oct): with one name request per page, a 52-page class
// set makes 52 requests, 4 at a time. The failure rate could not be measured on
// production -- no per-page name read has run there yet (its data ends at 03:09
// UTC 12 Oct, before #125 went live) -- and the old multi-page requests failed
// 3 in 43 outside the 25 Sep incident, above the 1-in-50 bar, so a failed read
// is retried with backoff before its page is left for the teacher.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const r = buildSync({ entryPoints: ["lib/teacher-class-scan.ts"], bundle: true, platform: "node", format: "cjs", write: false });
const m = { exports: {} };
new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
const { withRetry, mapLimit, mergeNameReads, NAME_RETRY_DELAYS_MS } = m.exports;

test("a read that fails twice then succeeds is used; the waits back off", async () => {
  const waits = [];
  let calls = 0;
  const out = await withRetry(async () => {
    if (++calls < 3) throw new Error("429");
    return "ok";
  }, NAME_RETRY_DELAYS_MS, async (ms) => void waits.push(ms), () => 0);
  assert.equal(out, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1500, 4000]);
});

test("three failures: the last error is thrown, so the page is left for the teacher as before", async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw new Error("boom " + calls); }, [1, 1], async () => {}), /boom 3/);
  assert.equal(calls, 3);
});

test("jitter is at most a quarter of the delay", async () => {
  const waits = [];
  await withRetry(async () => { if (waits.length < 1) throw new Error("x"); return 1; }, [1000], async (ms) => void waits.push(ms), () => 0.999);
  assert.ok(waits[0] >= 1000 && waits[0] <= 1250, String(waits[0]));
});

test("a 52-page set, 4 at a time, with a 1-in-10 transient failure: every page gets its name", async () => {
  // A stand-in for the service: each request fails at random 10% of the time.
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const slices = Array.from({ length: 52 }, (_, page) => [{ id: "n" + page, page }]);
  let requests = 0;
  const reads = await mapLimit(slices, 4, (slice) => withRetry(async () => {
    requests++;
    if (rand() < 0.1) throw new Error("503");
    return { pages: [{ page: 0, name: "Student " + slice[0].page, confidence: 95 }] };
  }, [1, 1], async () => {}), () => ({ failed: true }));
  const names = mergeNameReads(52, slices, reads);
  assert.equal(names.filter((n) => n.failed).length, 0, "no page left unread");
  assert.ok(requests > 52, "some were retried: " + requests);
});
