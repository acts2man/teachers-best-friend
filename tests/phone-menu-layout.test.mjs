// Michael, 19 Oct 2026 (Android Brave, about 412px wide): the phone menu showed
// New assessment and the credits, then the settings group, with the main pages
// squeezed into a short scroll area that looked empty.
//
// The cause: on phones the sidebar renders inside a sheet, and the sheet
// dropped the sidebar's className and had no sidebar-inner. None of the app's
// sidebar styles applied, so the stock layout ran -- the pages' area was the
// one that shrank and scrolled while the settings group kept its full height.
// Now the phone sheet carries the same class and inner element as the computer
// sidebar: the whole menu scrolls as one, the pages keep their height at the
// top, and the settings group follows directly under them.
// The browser check is scripts/browser-check/phone-menu.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebar = readFileSync("components/ui/sidebar.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");
const mobile = sidebar.slice(sidebar.indexOf("if (isMobile)"), sidebar.indexOf("</Sheet>"));

test("the phone sheet carries the sidebar's className", () => {
  assert.match(mobile, /<SheetContent[\s\S]*?className=\{cn\([\s\S]*?className\s*\)\}/);
});

test("the phone sheet has the same sidebar-inner as the computer sidebar", () => {
  assert.match(mobile, /data-slot="sidebar-inner"/);
});

test("the app's sidebar styles keep the pages at full height and scroll the menu as one", () => {
  assert.match(css, /\.app-sidebar \[data-slot=sidebar-inner\]\{overflow-y:auto/);
  assert.match(css, /\.app-sidebar \.brand-area,\.app-sidebar \.side-content,\.app-sidebar \.side-footer\{flex:0 0 auto\}/);
  assert.match(css, /\.app-sidebar \.side-content\{overflow:visible\}/);
});

test("on a phone the settings group sits directly under the pages", () => {
  assert.match(css, /\.app-sidebar\[data-mobile=true\] \.side-footer\{margin-top:0\}/);
});
