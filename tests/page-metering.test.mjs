// What a page costs, and what a teacher is told it costs.
//
// The database owns the hard part -- "this page has already been paid for" is
// a unique constraint, proved against production in
// supabase/checks/page-charges.sql, because this harness has no database. What
// is covered here is the JavaScript either side of it: counting the pages in a
// file, deciding which modes charge at all, and the sentence on the button
// that tells a teacher what pressing it will spend.
//
// That sentence is the one a teacher acts on. If it says "uses 30 scans" and
// 60 disappear, the number they were shown was a lie, and they find out from
// the meter afterwards.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";
import path from "node:path";

const ROOT = process.cwd();
// This file is an ES module; the bundles it builds are CommonJS, and ask for
// `require` when they reach pdfjs, which is left external so the real parser
// is the one under test.
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
    external: ["pdfjs-dist/legacy/build/pdf.mjs"],
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(
    m,
    m.exports,
    require,
  );
  return m.exports;
}

const { stackCost, gradeButtonLabel, overQuotaMessage } = bundle("lib/scan-cost.ts");

// ---------------------------------------------------------------
// Counting a stack
// ---------------------------------------------------------------

test("a photographed page is one page", () => {
  assert.equal(stackCost([1, 1, 1]).pages, 3);
});

test("a multi-page PDF costs its real page count", () => {
  // The whole reason page_count is read from the bytes server-side. A teacher
  // who uploads one five-page PDF has uploaded five pages.
  assert.equal(stackCost([5]).pages, 5);
  assert.equal(stackCost([1, 5, 1]).pages, 7);
});

test("a missing or nonsense count is treated as one page, never as zero", () => {
  // Never round a page down to free. An old draft with no count, or a bad
  // value, is one page -- not a way to grade for nothing.
  assert.equal(stackCost([0, -3, 1]).pages, 3);
});

test("pages already paid for are not charged again", () => {
  const cost = stackCost([1, 1, 1, 1], 4);
  assert.equal(cost.pages, 4);
  assert.equal(cost.charge, 0);
});

test("a partly paid stack charges only the new pages", () => {
  const cost = stackCost(Array(10).fill(1), 6);
  assert.equal(cost.charge, 4);
});

test("charge never goes negative", () => {
  // A stack smaller than what was reserved for it -- a teacher deleted pages
  // after reserving -- must not read as credit.
  assert.equal(stackCost([1, 1], 5).charge, 0);
});

// ---------------------------------------------------------------
// What the button says
// ---------------------------------------------------------------

test("the grade button states pages and the scans they will spend", () => {
  assert.equal(
    gradeButtonLabel(stackCost(Array(30).fill(1))),
    "Grade 30 pages · uses 30 scans",
  );
});

test("a re-grade says it costs nothing rather than staying silent", () => {
  // "uses 0 scans" is the answer to the question a teacher has when they
  // re-grade a class set they already paid for this morning.
  assert.equal(
    gradeButtonLabel(stackCost(Array(30).fill(1), 30)),
    "Grade 30 pages · uses 0 scans",
  );
});

test("a partly paid stack shows the real number, not the whole stack", () => {
  assert.equal(
    gradeButtonLabel(stackCost(Array(30).fill(1), 26)),
    "Grade 30 pages · uses 4 scans",
  );
});

test("singulars read as English", () => {
  assert.equal(gradeButtonLabel(stackCost([1])), "Grade 1 page · uses 1 scan");
});

test("an empty stack says nothing about cost", () => {
  assert.equal(gradeButtonLabel(stackCost([])), "Grade");
});

test("a PDF stack prices by pages, not by files", () => {
  // Three files, one of them six pages: the button must not say "3".
  assert.equal(
    gradeButtonLabel(stackCost([1, 6, 1])),
    "Grade 8 pages · uses 8 scans",
  );
});

// ---------------------------------------------------------------
// Being turned away
// ---------------------------------------------------------------

test("over quota says the size of the stack and what is left", () => {
  assert.equal(
    overQuotaMessage(30, 12),
    "This class set is 30 pages. You have 12 scans left.",
  );
});

test("out of scans does not say 'you have 0 scans left'", () => {
  assert.equal(
    overQuotaMessage(30, 0),
    "This class set is 30 pages. You have no scans left this period.",
  );
});

// ---------------------------------------------------------------
// Which modes charge
// ---------------------------------------------------------------

test("the privacy pass and the shared library never charge", () => {
  const { chargesForMode } = bundle("lib/page-ledger.ts");
  // name_strip is our own safeguard over pages the teacher is already paying
  // for -- the page is cut so no request holds a name beside its answers.
  // Charging for it would bill a teacher for our own privacy design.
  assert.equal(chargesForMode("name_strip"), false);
  // catalog unlocks standards into a library every teacher shares.
  assert.equal(chargesForMode("catalog"), false);
});

test("everything a teacher asks for charges", () => {
  const { chargesForMode } = bundle("lib/page-ledger.ts");
  for (const mode of [
    "assignment",
    "responses",
    "class_scan",
    "answer_key",
    "roster",
    "passage",
    "lesson",
  ])
    assert.equal(chargesForMode(mode), true, `${mode} should charge`);
});

test("a generation key is unique to its scan", () => {
  const { generationKey } = bundle("lib/page-ledger.ts");
  // Two generated lessons are two scans; a retry of the same one is free,
  // because it lands on the same key and therefore the same ledger row.
  assert.notEqual(generationKey("scan-a"), generationKey("scan-b"));
  assert.equal(generationKey("scan-a"), generationKey("scan-a"));
});

// ---------------------------------------------------------------
// Counting pages out of real bytes
// ---------------------------------------------------------------

/** A minimal but structurally valid PDF with `n` pages. */
function pdfOf(n) {
  const objs = [];
  const kids = [];
  for (let i = 0; i < n; i++) kids.push(`${4 + i} 0 R`);
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${n} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  for (let i = 0; i < n; i++)
    objs[4 + i] =
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 3 0 R >> >> >>";
  let out = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++)
    out += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// The real counter, against the real pdfjs. Stubbing the parser here would
// only prove the stub counts.
const pageCount = bundle("lib/page-count.ts");

async function pageCounter() {
  return pageCount;
}

test("an image is one page without being parsed", async () => {
  const { countPages } = await pageCounter();
  assert.equal(await countPages("image/jpeg", new ArrayBuffer(8)), 1);
  assert.equal(await countPages("image/png", new ArrayBuffer(8)), 1);
});

test("a five-page PDF counts five", async () => {
  const { countPages } = await pageCounter();
  const bytes = pdfOf(5);
  assert.equal(
    await countPages(
      "application/pdf",
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ),
    5,
  );
});

test("a one-page PDF counts one", async () => {
  const { countPages } = await pageCounter();
  const bytes = pdfOf(1);
  assert.equal(
    await countPages(
      "application/pdf",
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ),
    1,
  );
});

test("a PDF that will not parse is refused, not guessed at", async () => {
  const { countPages } = await pageCounter();
  // Guessing has two outcomes and both are wrong: guess low and the pages are
  // free, guess high and a teacher pays for pages that were never there.
  const junk = Buffer.from("%PDF-1.4 this is not a pdf");
  await assert.rejects(
    () =>
      countPages(
        "application/pdf",
        junk.buffer.slice(junk.byteOffset, junk.byteOffset + junk.byteLength),
      ),
    (e) => e.status === 400 && /couldn’t be read/.test(e.message),
  );
});

test("the same bytes hash the same, different bytes do not", async () => {
  const { contentHash } = await pageCounter();
  // This is what stops the body crop and the name strip of one photograph
  // being charged as two pages, and what makes a re-upload free.
  const a = Buffer.from("page one");
  const b = Buffer.from("page two");
  const ab = a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength);
  const bb = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  assert.equal(await contentHash(ab), await contentHash(ab));
  assert.notEqual(await contentHash(ab), await contentHash(bb));
  assert.match(await contentHash(ab), /^[0-9a-f]{64}$/);
});
