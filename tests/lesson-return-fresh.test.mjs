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

test("non-deliberate entries into /lessons set the fresh-entry flag (review of #216)", () => {
  assert.match(app, /import \{[^}]*LESSONS_FRESH_KEY[^}]*\} from "\.\/teacher-planning"/);
  // 1. The lessons nav item from another view sets it on tap.
  assert.match(app, /if \(n\.id === "lessons"\) \{[\s\S]*?sessionStorage\.setItem\(LESSONS_FRESH_KEY, "1"\)/);
  // 2. go() to the BARE /lessons from another route sets it too, so the Classes
  //    super-grid shortcut and the guide link start fresh rather than landing
  //    on the force-static router's stale ?lesson=. A deliberate open carries a
  //    param (!u.search guards that), and a reset already on /lessons does not.
  assert.match(
    app,
    /u\.pathname === "\/lessons" && !u\.search && window\.location\.pathname !== "\/lessons"\)\s*\n\s*sessionStorage\.setItem\(LESSONS_FRESH_KEY, "1"\)/,
  );
  const sets = [...app.matchAll(/sessionStorage\.setItem\(LESSONS_FRESH_KEY/g)].length;
  assert.equal(sets, 2, "the menu tap and the bare-/lessons go() -- and nothing else");
});

test("tapping Lesson Planning while already on it returns to Start in place (review of #216)", () => {
  // A same-view tap does not remount, so the flag would never be read: the
  // sidebar instead prevents the stale nav and fires a window event …
  assert.match(app, /import \{[^}]*LESSONS_MENU_TAP[^}]*\} from "\.\/teacher-planning"/);
  assert.match(
    app,
    /if \(view === "lessons"\) \{\s*\n\s*e\.preventDefault\(\);\s*\n\s*window\.dispatchEvent\(new Event\(LESSONS_MENU_TAP\)\);/,
    "same-view tap dispatches the event instead of a stale same-path navigation",
  );
  // … which the mounted lessons view handles by returning to Start -- but not
  // while a generate is running (it waits), and asking first when there is
  // unsaved work (the same path as the New lesson plan button).
  assert.match(planning, /export const LESSONS_MENU_TAP = "tbf:lessons-menu-tap"/);
  assert.match(
    planning,
    /const onTap = \(\) => \{[\s\S]*?if \(aiBusy\) \{[\s\S]*?Your lesson is still being written[\s\S]*?return;[\s\S]*?if \(unsavedWork\) setConfirmNew\(true\);\s*\n\s*else startNewPlan\(\);[\s\S]*?window\.addEventListener\(LESSONS_MENU_TAP, onTap\);/,
  );
});

test("changing the focus skill goes through the unsaved-work confirm, and waits while aiBusy (review of #216)", () => {
  // The Focus skill selector is disabled mid-generate and routes through
  // changeFocus, which blocks while aiBusy and otherwise confirms before reset.
  assert.match(planning, /onChange=\{changeFocus\}\s*\n\s*disabled=\{aiBusy\}/);
  assert.match(
    planning,
    /function changeFocus\(st: string\) \{[\s\S]*?if \(aiBusy\) \{[\s\S]*?return;[\s\S]*?if \(unsavedWork\) \{\s*\n\s*setPendingFocus\(st\);\s*\n\s*setConfirmNew\(true\);\s*\n\s*\} else reset\(st\);/,
  );
  // The discard confirm runs the pending focus change, or a new plan.
  assert.match(planning, /function confirmDiscard\(\) \{[\s\S]*?if \(st !== null\) reset\(st\);\s*\n\s*else startNewPlan\(\);/);
});
