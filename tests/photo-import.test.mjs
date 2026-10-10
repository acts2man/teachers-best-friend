// "Import from Photos" (class scan): a teacher picks a whole phone roll of a
// class set, we put the pages back in capture order and split them into one
// pile per student before uploading. These cover the pure logic -- the EXIF
// capture-time read, the capture-time ordering, and the split-by-breaks -- plus
// the component wiring. Whether a real phone roll imports cleanly still needs a
// phone.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";
import path from "node:path";

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

const {
  parseExifDateTime,
  exifDateToMs,
  orderByCaptureTime,
  everyNBreaks,
  groupByBreaks,
  DEFAULT_PAGES_PER_STUDENT,
} = bundle("lib/photo-import.ts");

// ---------------------------------------------------------------
// A hand-built EXIF JPEG so the parser can be tested without a photo.
// Layout: SOI, APP1("Exif\0\0" + TIFF). The TIFF carries IFD0 with an Exif
// sub-IFD pointer, and the sub-IFD carries DateTimeOriginal; optionally IFD0
// also carries a DateTime, to prove the fallback.
// ---------------------------------------------------------------
function buildExifJpeg({ le = true, original = null, dateTime = null } = {}) {
  // Build the TIFF block first (offsets are relative to its start).
  const strings = [];
  let cursor = 8; // after the 8-byte TIFF header
  const ifd0Entries = [];
  const exifEntries = [];

  // Reserve space: IFD0 (count + entries + next-offset), then Exif IFD, then
  // string data. We lay them out in that order and compute offsets.
  const ifd0Count = (dateTime ? 1 : 0) + (original ? 1 : 0); // DateTime + ExifPointer
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const exifStart = original ? cursor + ifd0Size : 0;
  const exifCount = original ? 1 : 0;
  const exifSize = original ? 2 + exifCount * 12 + 4 : 0;
  let strCursor = cursor + ifd0Size + exifSize;

  const asciiEntry = (tag, s) => {
    const off = strCursor;
    const bytes = [...s].map((c) => c.charCodeAt(0));
    bytes.push(0);
    while (bytes.length < 20) bytes.push(0);
    strings.push({ off, bytes });
    strCursor += bytes.length;
    return { tag, type: 2, count: bytes.length, value: off };
  };

  if (dateTime) ifd0Entries.push(asciiEntry(0x0132, dateTime));
  if (original) ifd0Entries.push({ tag: 0x8769, type: 4, count: 1, value: exifStart });
  if (original) exifEntries.push(asciiEntry(0x9003, original));

  const total = strCursor;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  // TIFF header
  dv.setUint16(0, le ? 0x4949 : 0x4d4d);
  dv.setUint16(2, 0x002a, le);
  dv.setUint32(4, 8, le); // IFD0 at offset 8

  const writeDir = (at, entries) => {
    dv.setUint16(at, entries.length, le);
    entries.forEach((e, i) => {
      const eo = at + 2 + i * 12;
      dv.setUint16(eo, e.tag, le);
      dv.setUint16(eo + 2, e.type, le);
      dv.setUint32(eo + 4, e.count, le);
      dv.setUint32(eo + 8, e.value, le);
    });
    dv.setUint32(at + 2 + entries.length * 12, 0, le); // no next IFD
  };
  writeDir(cursor, ifd0Entries);
  if (original) writeDir(exifStart, exifEntries);
  for (const s of strings) for (let i = 0; i < s.bytes.length; i++) dv.setUint8(s.off + i, s.bytes[i]);

  const tiff = new Uint8Array(buf);
  // Wrap in JPEG SOI + APP1.
  const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  const app1Len = 2 + exifHeader.length + tiff.length; // length field counts itself
  const out = [0xff, 0xd8, 0xff, 0xe1, (app1Len >> 8) & 0xff, app1Len & 0xff, ...exifHeader, ...tiff];
  return new DataView(new Uint8Array(out).buffer);
}

// ---------------------------------------------------------------
// exifDateToMs
// ---------------------------------------------------------------

test("exifDateToMs parses the EXIF datetime format, deterministically (UTC)", () => {
  assert.equal(exifDateToMs("2021:07:04 09:30:15"), Date.UTC(2021, 6, 4, 9, 30, 15));
  // Later time -> larger number (the only property ordering relies on).
  assert.ok(exifDateToMs("2021:07:04 09:30:16") > exifDateToMs("2021:07:04 09:30:15"));
  assert.equal(exifDateToMs("not a date"), null);
  assert.equal(exifDateToMs(""), null);
});

// ---------------------------------------------------------------
// parseExifDateTime
// ---------------------------------------------------------------

test("parseExifDateTime reads DateTimeOriginal from the Exif sub-IFD (both endians)", () => {
  for (const le of [true, false]) {
    const dv = buildExifJpeg({ le, original: "2022:01:02 03:04:05" });
    assert.equal(
      parseExifDateTime(dv),
      Date.UTC(2022, 0, 2, 3, 4, 5),
      (le ? "little" : "big") + "-endian",
    );
  }
});

test("parseExifDateTime prefers DateTimeOriginal but falls back to IFD0 DateTime", () => {
  const withOriginal = buildExifJpeg({ original: "2022:01:02 03:04:05", dateTime: "2000:01:01 00:00:00" });
  assert.equal(parseExifDateTime(withOriginal), Date.UTC(2022, 0, 2, 3, 4, 5), "prefers original");
  const dateTimeOnly = buildExifJpeg({ dateTime: "2019:12:31 23:59:59" });
  assert.equal(parseExifDateTime(dateTimeOnly), Date.UTC(2019, 11, 31, 23, 59, 59), "falls back");
});

test("parseExifDateTime returns null for a non-JPEG or a JPEG with no EXIF", () => {
  assert.equal(parseExifDateTime(new DataView(new Uint8Array([1, 2, 3, 4]).buffer)), null, "not a JPEG");
  // A bare JPEG (SOI then EOI), no APP1.
  assert.equal(parseExifDateTime(new DataView(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer)), null);
  // A JPEG whose EXIF carries no datetime tag at all.
  assert.equal(parseExifDateTime(buildExifJpeg({})), null, "EXIF present but no datetime");
});

// ---------------------------------------------------------------
// orderByCaptureTime
// ---------------------------------------------------------------

test("orderByCaptureTime sorts by capture time when every photo has one", () => {
  // Selection order was scrambled; capture time puts them right.
  const order = orderByCaptureTime([{ time: 300 }, { time: 100 }, { time: 200 }]);
  assert.deepEqual(order, [1, 2, 0]);
});

test("equal capture times keep selection order (stable)", () => {
  assert.deepEqual(orderByCaptureTime([{ time: 5 }, { time: 5 }, { time: 5 }]), [0, 1, 2]);
});

test("a half-timed batch falls back entirely to selection order", () => {
  // One photo lost its EXIF; we do not half-sort, which would scramble.
  assert.deepEqual(orderByCaptureTime([{ time: 300 }, { time: null }, { time: 100 }]), [0, 1, 2]);
});

test("no photos -> empty order", () => {
  assert.deepEqual(orderByCaptureTime([]), []);
});

// ---------------------------------------------------------------
// everyNBreaks + groupByBreaks
// ---------------------------------------------------------------

test("everyNBreaks places a boundary before every Nth page", () => {
  assert.deepEqual(everyNBreaks(6, 2), [2, 4], "6 pages, 2 each -> 3 students");
  assert.deepEqual(everyNBreaks(5, 2), [2, 4], "an odd page makes a short last pile");
  assert.deepEqual(everyNBreaks(4, 1), [1, 2, 3], "1 per student -> a pile each");
  assert.deepEqual(everyNBreaks(3, 5), [], "fewer pages than one student -> no breaks");
  assert.deepEqual(everyNBreaks(4, 0), [1, 2, 3], "a zero per-student is treated as 1");
});

test("the default split is two pages per student", () => {
  assert.equal(DEFAULT_PAGES_PER_STUDENT, 2);
  assert.deepEqual(groupByBreaks(6, everyNBreaks(6, DEFAULT_PAGES_PER_STUDENT)), [
    [0, 1],
    [2, 3],
    [4, 5],
  ]);
});

test("groupByBreaks splits ordered positions into piles at the breaks", () => {
  assert.deepEqual(groupByBreaks(5, [2, 4]), [[0, 1], [2, 3], [4]]);
  assert.deepEqual(groupByBreaks(3, []), [[0, 1, 2]], "no breaks -> one pile");
  assert.deepEqual(groupByBreaks(0, [1]), [], "no pages -> no piles");
});

test("groupByBreaks ignores out-of-range and duplicate breaks and never yields an empty pile", () => {
  assert.deepEqual(groupByBreaks(4, [0, 2, 2, 4, 9, -1]), [[0, 1], [2, 3]]);
});

// ---------------------------------------------------------------
// Component + wiring (source assertions)
// ---------------------------------------------------------------

const comp = readFileSync("components/photo-import.tsx", "utf8");
const scan = readFileSync("components/teacher-class-scan.tsx", "utf8");

test("the importer reads capture times, orders by them, and defaults to a two-page split", () => {
  assert.match(comp, /readExifTimestamp/, "reads EXIF capture time");
  assert.match(comp, /orderByCaptureTime/, "orders by it");
  assert.match(comp, /everyNBreaks/, "splits into piles");
  assert.match(comp, /DEFAULT_PAGES_PER_STUDENT/, "defaults to two pages per student");
});

test("the importer lets the teacher fix the split and hands back grouped files", () => {
  // A per-student stepper and per-gap split/merge, then a confirm that builds
  // File[][] for onComplete.
  assert.match(comp, /onComplete\(/, "hands grouped files back");
  assert.match(comp, /groupByBreaks/, "the split is driven by the breaks the teacher sets");
});

test("the class scan opens the importer and feeds its groups to the existing pipeline", () => {
  assert.match(scan, /PhotoImport/, "renders the importer");
  assert.match(scan, /Import from Photos/, "offers it by name");
  // Its result reuses addCameraGroups -- the same upload/split/grade path as the
  // in-app camera, so there is no second pipeline to keep in step.
  assert.match(scan, /addCameraGroups\(/, "reuses the camera's group pipeline");
});
