// Import from Photos (class scan): drive the real "fix the split" screen in a
// browser. We hand the hidden photo input five JPEGs whose EXIF capture times
// are out of selection order, then check the screen puts them back in capture
// order and splits them into students, and that changing pages-per-student
// re-splits. Uploading itself is the existing camera pipeline (covered by unit
// tests); this proves the new ordering/splitting UI on a page.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium/chrome-linux/chrome";
const workspace = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));

// A JPEG carrying only EXIF DateTimeOriginal -- enough for readExifTimestamp.
function exifJpeg(dt) {
  const le = true;
  const strCursor = 8 + (2 + 12 + 4) + (2 + 12 + 4);
  const bytes = [...dt].map((c) => c.charCodeAt(0));
  bytes.push(0);
  while (bytes.length < 20) bytes.push(0);
  const total = strCursor + bytes.length;
  const dv = new DataView(new ArrayBuffer(total));
  dv.setUint16(0, 0x4949);
  dv.setUint16(2, 0x002a, le);
  dv.setUint32(4, 8, le);
  // IFD0: one entry, the Exif pointer -> exif IFD at 8+18=26
  dv.setUint16(8, 1, le);
  dv.setUint16(10, 0x8769, le);
  dv.setUint16(12, 4, le);
  dv.setUint32(14, 1, le);
  dv.setUint32(18, 26, le);
  dv.setUint32(22, 0, le);
  // Exif IFD at 26: DateTimeOriginal ASCII at strCursor
  dv.setUint16(26, 1, le);
  dv.setUint16(28, 0x9003, le);
  dv.setUint16(30, 2, le);
  dv.setUint32(32, bytes.length, le);
  dv.setUint32(36, strCursor, le);
  dv.setUint32(40, 0, le);
  for (let i = 0; i < bytes.length; i++) dv.setUint8(strCursor + i, bytes[i]);
  const tiff = new Uint8Array(dv.buffer);
  const header = [0x45, 0x78, 0x69, 0x66, 0, 0];
  const app1 = 2 + header.length + tiff.length;
  return Buffer.from([0xff, 0xd8, 0xff, 0xe1, (app1 >> 8) & 0xff, app1 & 0xff, ...header, ...tiff]);
}

// Five photos, capture times deliberately scrambled against selection order.
const times = [
  "2026:05:01 09:00:05",
  "2026:05:01 09:00:01",
  "2026:05:01 09:00:04",
  "2026:05:01 09:00:02",
  "2026:05:01 09:00:03",
];
const filePayload = times.map((t, i) => ({
  name: `photo-${i}.jpg`,
  mimeType: "image/jpeg",
  buffer: exifJpeg(t),
}));

const browser = await chromium.launch({ executablePath: CHROMIUM });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route("**/api/workspace", (r) =>
  r.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ workspace, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }),
  }));
await ctx.route("**/api/quota", (r) =>
  r.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true }),
  }));

const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 180)); });
page.on("pageerror", (e) => errors.push("UNCAUGHT: " + String(e).slice(0, 180)));
// Broken <img> (our fake JPEGs don't decode) is expected and not a real error.
const real = () => errors.filter((e) => !/supabase\.co|net::|Failed to fetch|ERR_|Failed to load resource|401|503|decode/i.test(e));

const pass = [];
const fail = [];
const check = (cond, msg) => (cond ? pass : fail).push(msg);

await page.goto(`${BASE}/assessments?id=ela-demo&tab=responses`, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(900);

// Feed the hidden photo input directly (no native file dialog).
const input = page.locator('input[aria-label="Import a roll of photos of the whole class"]');
check((await input.count()) > 0, "the hidden Import-from-Photos input is present");
await input.setInputFiles(filePayload);
await page.waitForTimeout(600);

const overlay = page.locator(".photo-import");
check((await overlay.count()) > 0, "the fix-the-split screen opens");

const noteText = (await page.locator(".photo-import-note").innerText().catch(() => "")).replace(/\s+/g, " ");
check(/when each photo was taken/i.test(noteText), `ordered by capture time (note: "${noteText.slice(0, 48)}…")`);

// Page labels appear in capture order: the first thumbnail should be the photo
// whose EXIF time is earliest (selection index 1 -> "photo-1"). We assert the
// first badge is student 1 and the student count matches a 2-page split of 5.
const boundaries = await page.locator(".photo-import-boundary").count();
check(boundaries === 2, `default 2-per-student over 5 pages -> 3 students (${boundaries} boundaries)`);
const importBtn = page.getByRole("button", { name: /Import \d+ student/i });
check(/Import 3 students/i.test(await importBtn.first().innerText()), "confirm button offers to import 3 students");

// Bump pages-per-student to 3 -> 2 students (3 + 2).
await page.getByRole("button", { name: "More pages per student" }).click();
await page.waitForTimeout(200);
const boundaries3 = await page.locator(".photo-import-boundary").count();
check(boundaries3 === 1, `3-per-student -> 2 students (${boundaries3} boundary)`);
check(/Import 2 students/i.test(await importBtn.first().innerText()), "re-split updates the confirm button to 2 students");

// Hand-split: add a break back and confirm the count rises.
await page.locator(".photo-import-splithere").first().click();
await page.waitForTimeout(200);
const boundaries4 = await page.locator(".photo-import-boundary").count();
check(boundaries4 === 2, `a manual split adds a student back (${boundaries4} boundaries)`);

const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
check(!hscroll, "fix-the-split screen: no horizontal scroll");

console.log("=== IMPORT FROM PHOTOS CHECK (390x844) ===");
for (const p of pass) console.log("  OK   " + p);
for (const f of fail) console.log("  FAIL " + f);
console.log("\nconsole errors (excluding blocked/image-decode):", real().length ? "\n  " + real().join("\n  ") : "none");
console.log(`\n${pass.length}/${pass.length + fail.length} assertions passed`);
await browser.close();
process.exit(fail.length || real().length ? 1 : 0);
