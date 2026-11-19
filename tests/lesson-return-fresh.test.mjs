// Ricky, 17 Nov 2026 (iPhone Chrome iOS, production): opened a saved lesson,
// refreshed, tapped another menu option and came back to Lesson Planning — and
// it was still stuck on the previous lesson. The screens are force-static
// pages, and Next 16.2.6's router keeps the /lessons route's cached URL,
// including a stale ?lesson=, so returning re-opened the last lesson.
//
// Fix: a plain "Lesson Planning" menu tap flags a fresh entry (sessionStorage),
// and the lessons view, when it next mounts, drops any ?lesson=/?standard= the
// router kept and shows the Start panel instead of the old lesson. An in-app
// "open this lesson" never sets the flag, so deliberate opens still work.
// Behaviour is proven end-to-end in scripts/browser-check/lesson-return-fresh.mjs;
// this pins the mechanism so it cannot be dropped. Fails on fa78647.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const planning = readFileSync("components/teacher-planning.tsx", "utf8");
const app = readFileSync("components/teacher-app.tsx", "utf8");

test("the lessons view consumes a fresh-entry flag and ignores a stale open param", () => {
  assert.match(planning, /export const LESSONS_FRESH_KEY = "tbf:lessons-fresh"/);
  // Read once, on mount, and cleared so it affects only this entry.
  assert.match(planning, /useState\(\(\) => \{[\s\S]*?sessionStorage\.getItem\(LESSONS_FRESH_KEY\)[\s\S]*?sessionStorage\.removeItem\(LESSONS_FRESH_KEY\)/);
  // While a fresh entry is still shedding a stale param, the Start panel shows…
  assert.match(planning, /const suppressStale = stripping && hasOpenParam;/);
  assert.match(planning, /const choosing = suppressStale \|\| !hasOpenParam;/);
  // …the stale lesson is not loaded…
  assert.match(planning, /if \(suppressStale\) return;/);
  // …and the URL is stripped to bare /lessons, then suppression ends so a
  // deliberately opened lesson still opens.
  assert.match(planning, /if \(hasOpenParam\) go\("\/lessons"\);\s*else setStripping\(false\);/);
});

test("only a Lesson Planning menu tap sets the fresh-entry flag", () => {
  assert.match(app, /import \{[^}]*LESSONS_FRESH_KEY[^}]*\} from "\.\/teacher-planning"/);
  // The flag is set for the lessons nav item on tap; nothing else sets it.
  assert.match(app, /if \(n\.id === "lessons"\) \{[\s\S]*?sessionStorage\.setItem\(LESSONS_FRESH_KEY, "1"\)/);
  const sets = [...app.matchAll(/sessionStorage\.setItem\(LESSONS_FRESH_KEY/g)].length;
  assert.equal(sets, 1, "exactly one place sets the flag");
});
