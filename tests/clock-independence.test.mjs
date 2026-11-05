// No test depends on today's date (review of #206). A test that compared a
// fixed date with the real clock passed until the calendar reached it, then
// failed on main for a reason that was not the code's: tests/stale-failed-
// count.test.mjs did on 5 Nov 2026 (expires_at "2026-11-05" read as expired),
// and tests/orphan-photos.test.mjs would have with the clock moved back (its
// files dated October 2026 read as uploads still in flight). Proven when the
// tests that touch dates pass with the clock moved a year back and a year
// ahead. CI runs the whole suite that way too (npm run test:clock).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Through NODE_OPTIONS, so it reaches every process a test starts (the test
// runner runs each file, and some files a CLI, in a process of its own).
const SHIFT = "--import=" + resolve("scripts/shift-clock.mjs");
// Without NODE_TEST_CONTEXT: inside a test, a nested `node --test` otherwise
// reports to this runner and exits 0 whatever happened.
const { NODE_TEST_CONTEXT: _ctx, ...ENV } = process.env;
void _ctx;

const SENSITIVE = [
  "tests/orphan-photos.test.mjs",
  "tests/stale-failed-count.test.mjs",
  "tests/school-year.test.mjs",
  "tests/upload-reload.test.mjs",
];

for (const days of [-400, 400]) {
  test(`the date-sensitive tests pass with the clock moved ${days} days`, () => {
    const r = spawnSync(process.execPath, ["--test", ...SENSITIVE], {
      encoding: "utf8",
      env: { ...ENV, SHIFT_DAYS: String(days), NODE_OPTIONS: SHIFT },
    });
    const failed = (r.stdout.match(/^not ok .*$/gm) ?? []).join("\n");
    assert.equal(r.status, 0, `failed with the clock moved ${days} days:\n${failed}`);
  });
}

test("the shift really moves the clock", () => {
  // Against an unshifted child, not this process: under npm run test:clock
  // this process's own clock is moved too.
  const at = (days) => {
    const r = spawnSync(process.execPath, ["-e", "console.log(Date.now(), new Date().getTime())"], {
      encoding: "utf8",
      env: { ...ENV, SHIFT_DAYS: String(days), NODE_OPTIONS: SHIFT },
    });
    return r.stdout.trim().split(" ").map(Number);
  };
  const [base] = at(0);
  const [a, b] = at(-400);
  const want = base - 400 * 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(a - want) < 60_000 && Math.abs(b - want) < 60_000, `${a} ${b} vs ${want}`);
});
