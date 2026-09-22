// Importing a roster from a file a school system produced.
//
// Every fixture in tests/fixtures/rosters/ is an invented class. The names are
// made up; the shapes are not -- district exports really do carry student IDs
// and birthdates next to the names, really do put three periods in one file,
// and Excel on Windows really does still write CSV as Windows-1252.
//
// Two things are being proved here. That the right names come out, and that
// nothing else does: the test that greps the output for a student ID and a
// birthdate is the one that makes "we only read the name column" a fact rather
// than an intention.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
const FIXTURES = path.join(ROOT, "tests/fixtures/rosters");
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

const R = bundle("lib/roster-import.ts");
const F = bundle("lib/roster-file.ts");
const C = bundle("lib/teacher-classes.ts");

const bytes = (name) => fs.readFileSync(path.join(FIXTURES, name));
const rowsOf = (name) => R.parseDelimited(R.decodeRosterBytes(bytes(name)));
/** The whole pipeline: bytes -> rows -> plan -> names. */
function importFile(name, choice = {}) {
  const plan = R.planImport(rowsOf(name));
  return { plan, ...R.extractNames(plan, choice) };
}
const justNames = (result) => result.names.map((n) => n.name);

// ---------------------------------------------------------------
// The shape a school system actually exports
// ---------------------------------------------------------------

test("a district export with three periods filters to the one period asked for", () => {
  const { plan } = importFile("school-export-three-periods.csv");
  assert.equal(plan.mode, "firstLast");
  assert.deepEqual(plan.periods, ["2", "3", "5"], "all three periods are offered");

  const second = R.extractNames(plan, { period: "2" });
  assert.deepEqual(justNames(second), ["Amelia Rivera", "Benjamin Okafor", "Chloe Delacroix"]);

  const third = R.extractNames(plan, { period: "3" });
  assert.deepEqual(justNames(third), ["Daniel Hollis", "Elena Marchetti"]);

  // No period chosen keeps everyone, rather than silently picking one.
  assert.equal(R.extractNames(plan, {}).names.length, 6);
});

test("no student ID, birthdate or grade survives into the output", () => {
  const { plan } = importFile("school-export-three-periods.csv");
  const everything = JSON.stringify(R.extractNames(plan, {}).names);
  // Straight from the fixture: the columns a district ships next to the names.
  for (const secret of ["884213", "884990", "885017", "885130", "885244", "885388"])
    assert.ok(!everything.includes(secret), `student ID ${secret} must not appear`);
  for (const dob of ["2015-04-11", "2015-09-02", "2015-01-27", "2015-11-30"])
    assert.ok(!everything.includes(dob), `birthdate ${dob} must not appear`);
  // And nothing that merely looks like an identifier either.
  assert.ok(!/\d{4,}/.test(everything), "no long number survives anywhere in the output");
});

test("the .xlsx twin produces exactly what the .csv produces", async () => {
  const readXlsxFile = require("read-excel-file/node");
  const raw = await readXlsxFile(path.join(FIXTURES, "school-export-three-periods.xlsx"));
  const rows = F.normalizeExcelRows(raw);

  const fromExcel = R.planImport(rows);
  const fromCsv = R.planImport(rowsOf("school-export-three-periods.csv"));
  assert.deepEqual(fromExcel.periods, fromCsv.periods);
  assert.equal(fromExcel.mode, fromCsv.mode);
  for (const period of ["2", "3", "5"])
    assert.deepEqual(
      justNames(R.extractNames(fromExcel, { period })),
      justNames(R.extractNames(fromCsv, { period })),
      `period ${period} matches between .xlsx and .csv`,
    );
});

// ---------------------------------------------------------------
// One column, in the form school systems write it
// ---------------------------------------------------------------

test('a single "Student Name" column in "Last, First" form comes out first-name-first', () => {
  const result = importFile("student-name-last-first.csv");
  assert.equal(result.plan.mode, "full");
  assert.deepEqual(justNames(result), ["Bo Nguyen", "Adaeze Ifeoma Okonkwo", "Mateo Vasquez"]);
});

test("a column with no header asks which column rather than guessing", () => {
  const { plan } = importFile("no-header-one-column.csv");
  assert.equal(plan.mode, "choose", "it must ask");
  assert.equal(plan.headers, null, "row one is data, not a header");
  assert.equal(plan.body.length, 3, "and row one is still imported");
  // The picker gets something to show.
  assert.deepEqual(plan.candidates[0].samples, ["Amelia Rivera", "Benjamin Okafor", "Chloe Delacroix"]);
  // Once told, it reads the column.
  const chosen = R.extractNames(plan, { nameColumn: 0 });
  assert.deepEqual(justNames(chosen), ["Amelia Rivera", "Benjamin Okafor", "Chloe Delacroix"]);
});

// ---------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------

test("a UTF-8 byte-order mark does not become part of the first header", () => {
  const text = R.decodeRosterBytes(bytes("utf8-bom.csv"));
  assert.ok(!text.startsWith("﻿"), "the BOM is stripped");
  const result = importFile("utf8-bom.csv");
  assert.equal(result.plan.mode, "firstLast", "the first header still reads as First Name");
  assert.deepEqual(justNames(result), ["José Muñoz", "Zoë Ngô"]);
});

test("Windows-1252 bytes from Excel decode to the right accented names", () => {
  // The failure this prevents is not an error message. It is "JosÃ© MuÃ±oz"
  // saved to a child's record and printed on their report.
  const raw = bytes("windows-1252.csv");
  assert.throws(
    () => new TextDecoder("utf-8", { fatal: true }).decode(raw),
    "the fixture really is not valid UTF-8, or this test proves nothing",
  );
  const result = importFile("windows-1252.csv");
  assert.deepEqual(justNames(result), ["José Muñoz", "Zoë Ngô"]);
  const text = JSON.stringify(result.names);
  assert.ok(!text.includes("Ã"), "no mojibake");
  assert.ok(!text.includes("�"), "and no replacement character");
});

// ---------------------------------------------------------------
// The awkward parts of CSV
// ---------------------------------------------------------------

test("quoted commas, escaped quotes, CRLF and blank rows all survive", () => {
  const rows = rowsOf("messy-quotes-blanks.csv");
  assert.equal(rows.length, 3, "header plus two students; the blank rows are dropped");
  assert.deepEqual(rows[1], ["Nguyen, Bo", "Reads well, needs number line", ""]);
  assert.deepEqual(rows[2], ["Okafor, Benjamin", 'Said "ready" on Tuesday', ""]);

  const result = importFile("messy-quotes-blanks.csv");
  assert.deepEqual(justNames(result), ["Bo Nguyen", "Benjamin Okafor"]);
  // The notes column is never read, commas in it or not.
  assert.ok(!JSON.stringify(result.names).includes("number line"));
});

test("the delimiter is sniffed, so pasted spreadsheet rows parse as columns", () => {
  assert.equal(R.sniffDelimiter("First Name\tLast Name\nBo\tNguyen"), "\t");
  assert.equal(R.sniffDelimiter("First Name,Last Name\nBo,Nguyen"), ",");
  assert.equal(R.sniffDelimiter("First Name;Last Name\nBo;Nguyen"), ";");
  const rows = R.parseDelimited("First Name\tLast Name\r\nBo\tNguyen\r\n");
  assert.deepEqual(rows, [["First Name", "Last Name"], ["Bo", "Nguyen"]]);
});

// ---------------------------------------------------------------
// Preferred names
// ---------------------------------------------------------------

test("a preferred name replaces the first name, and says that it did", () => {
  const result = importFile("preferred-name.csv");
  assert.deepEqual(justNames(result), ["Bart Kowalski", "Margaret Ellison", "Nkechi Adeyemi"]);
  assert.equal(result.names[0].preferred, true, "Bartholomew -> Bart is flagged");
  assert.equal(result.names[1].preferred, false, "an empty preferred column is not");
  assert.equal(
    result.names[2].preferred,
    false,
    "and a preferred name identical to the first name is not worth flagging",
  );
});

// ---------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------

test("duplicates inside the file collapse, and names already in the class come pre-unticked", () => {
  const result = importFile("duplicates.csv");
  assert.equal(result.names.length, 4, "the file really does repeat a name");

  const rows = R.buildReviewRows(result.names, []);
  assert.deepEqual(
    rows.map((r) => r.name),
    ["Amelia Rivera", "Benjamin Okafor"],
    "three spellings of one child become one row",
  );

  const withExisting = R.buildReviewRows(result.names, ["amelia   RIVERA"]);
  assert.equal(withExisting[0].existing, true, "already in the class, whatever the spacing and case");
  assert.equal(withExisting[1].existing, false);
});

test("an enrolled short name is a possible match, not a decision", () => {
  // This test used to assert the opposite: that "Amelia Rivera" arriving into a
  // class holding "Amelia R." was the same child, settled, unticked. It is the
  // behaviour this change exists to remove. Amelia R. is Amelia Rivera or she
  // is Amelia Rodriguez, and the class list cannot say which -- it threw the
  // surname away when it saved her. So the row is offered, ticked, with the
  // doubt written on it, and the teacher settles it.
  const imported = [{ name: "Amelia Rivera" }, { name: "Benjamin Okafor" }];
  const rows = R.buildReviewRows(imported, ["Amelia R."]);
  assert.equal(rows[0].existing, false, "not claimed to be the same child");
  assert.equal(rows[0].possibleMatch, "Amelia R.", "but the teacher is told");
  assert.equal(rows[1].possibleMatch, undefined, "and nobody else is bothered");

  // An exact full-name match is a certainty, and carries no doubt with it.
  const exact = R.buildReviewRows(imported, ["Amelia Rivera"]);
  assert.equal(exact[0].existing, true);
  assert.equal(exact[0].possibleMatch, undefined);
});

// ---------------------------------------------------------------
// Nothing disappears quietly
// ---------------------------------------------------------------

test("150 rows: every one is read, and the limit is said out loud", () => {
  const result = importFile("one-hundred-fifty.csv");
  assert.equal(result.names.length, 150, "nothing is dropped on the way in");
  assert.equal(result.total, 150);

  const message = R.overLimitMessage(150, 150, false);
  assert.match(message, /This file has 150 names/);
  assert.match(message, /up to 100 can be added at once/);

  // With periods available the message says so, because that is the easier fix.
  assert.match(R.overLimitMessage(142, 142, true), /Choose a period or untick some/);

  // Under the limit there is nothing to say.
  assert.equal(R.overLimitMessage(80, 80, false), "");
  assert.equal(R.overLimitMessage(150, 100, false), "", "unticking down to the limit clears it");
});

// ---------------------------------------------------------------
// The paste box regression
// ---------------------------------------------------------------

test('"Nguyen, Bo" pasted on its own line is one student, not two', () => {
  // The bug: names.split(/[\n,]/) made "Nguyen" and "Bo", saved immediately.
  assert.deepEqual(R.namesFromPaste("Nguyen, Bo"), ["Bo Nguyen"]);
});

test("a column of Last, First lines each become one student", () => {
  const pasted = "Nguyen, Bo\nOkafor, Benjamin\nRivera, Amelia";
  assert.deepEqual(R.namesFromPaste(pasted), ["Bo Nguyen", "Benjamin Okafor", "Amelia Rivera"]);
});

test("a single line of several commas is still a list of names", () => {
  assert.deepEqual(R.namesFromPaste("Amelia R., Benjamin L., Chloe M."), [
    "Amelia R.",
    "Benjamin L.",
    "Chloe M.",
  ]);
});

test("plain lines and tab-separated names on one line both work", () => {
  assert.deepEqual(R.namesFromPaste("Amelia R.\nBenjamin L.\nChloe M."), [
    "Amelia R.",
    "Benjamin L.",
    "Chloe M.",
  ]);
  assert.deepEqual(R.namesFromPaste("Amelia R.\tBenjamin L."), ["Amelia R.", "Benjamin L."]);
  assert.deepEqual(R.namesFromPaste("   \n\n  "), []);
});

test("pasted spreadsheet rows are recognised as a table, not a name list", () => {
  // Two columns pasted from Excel. Splitting on tabs here would double the
  // class: "Bo", "Nguyen", "Amelia", "Rivera".
  const pasted = "First Name\tLast Name\nBo\tNguyen\nAmelia\tRivera";
  assert.equal(R.pasteLooksLikeTable(pasted), true);
  const plan = R.planImport(R.parseDelimited(pasted));
  assert.deepEqual(justNames(R.extractNames(plan, {})), ["Bo Nguyen", "Amelia Rivera"]);

  assert.equal(R.pasteLooksLikeTable("Amelia R.\nBenjamin L."), false);
  assert.equal(R.pasteLooksLikeTable("Amelia R.\tBenjamin L."), false, "one line is not a table");
});

// ---------------------------------------------------------------
// The old silent truncation
// ---------------------------------------------------------------

test("namesFromText no longer stops at 60 names without saying so", () => {
  const T = bundle("lib/teacher-classes.ts");
  // Alphabetic, because namesFromText deliberately rejects anything with a
  // digit in it -- that is how it drops ID columns out of a typed PDF. A
  // fixture of "Student01" would be filtered before the cap was ever reached,
  // and the test would pass for the wrong reason once the cap was gone.
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const word = (n) => letters[Math.floor(n / 26) % 26] + letters[n % 26] + letters[(n * 7) % 26];
  const text = Array.from({ length: 75 }, (_, i) => `Aa${word(i)} Bb${word(i + 3)}`).join("\n");
  const found = T.namesFromText(text);
  assert.equal(new Set(text.split("\n")).size, 75, "the fixture really is 75 distinct names");
  assert.equal(found.length, 75, "all 75 are returned for review");
});

test("flipLastFirst leaves anything it cannot read confidently alone", () => {
  assert.equal(R.flipLastFirst("Nguyen, Bo"), "Bo Nguyen");
  assert.equal(R.flipLastFirst("Nguyen, Bo Minh"), "Bo Minh Nguyen");
  assert.equal(R.flipLastFirst("Bo Nguyen"), "Bo Nguyen");
  // Two commas could be reordered three ways; guessing renames a child.
  assert.equal(R.flipLastFirst("Nguyen, Bo, Jr"), "Nguyen, Bo, Jr");
  assert.equal(R.flipLastFirst("Nguyen,"), "Nguyen,");
});

test("header matching ignores case, spacing and punctuation", () => {
  for (const spelling of ["First Name", "first name", "FIRST_NAME", " First-Name ", "firstname"]) {
    const plan = R.planImport([[spelling, "Last Name"], ["Bo", "Nguyen"]]);
    assert.equal(plan.mode, "firstLast", `${spelling} is recognised`);
  }
  assert.equal(R.normalizeHeader(" Student  Full-Name! "), "studentfullname");
});

test("two full-name candidates and no first/last is a question, not a guess", () => {
  const plan = R.planImport([
    ["Student Name", "Pupil Name"],
    ["Bo Nguyen", "Bo N"],
  ]);
  assert.equal(plan.mode, "choose");
  assert.equal(plan.candidates.length, 2);
});

test("a period column with only one value is not worth asking about", () => {
  const plan = R.planImport([
    ["First Name", "Last Name", "Period"],
    ["Bo", "Nguyen", "2"],
    ["Amelia", "Rivera", "2"],
  ]);
  assert.equal(plan.periodColumn, null);
  assert.deepEqual(plan.periods, []);
});

test("the sample file is a two-column CSV with three made-up names", () => {
  const rows = R.parseDelimited(R.SAMPLE_CSV);
  assert.deepEqual(rows[0], ["First Name", "Last Name"]);
  assert.equal(rows.length, 4);
  const plan = R.planImport(rows);
  assert.deepEqual(justNames(R.extractNames(plan, {})), [
    "Amelia Rivera",
    "Benjamin Okafor",
    "Chloe Delacroix",
  ]);
});

// ---------------------------------------------------------------
// Two children who shorten alike
// ---------------------------------------------------------------

/**
 * The whole path a name walks, in the order the app walks it: the review list
 * decides who is on it, the shortener names everyone at once against the class
 * as it stands, and the save guard has the last word. Written out here because
 * the bug this section exists for lived in the joins, not in any one step --
 * each piece was defensible and the composition dropped children.
 */
function reviewAndSave(imported, existingNames = [], short = true) {
  const rows = R.buildReviewRows(imported, existingNames);
  const ticked = rows.filter((r) => !r.existing);
  const shown = short
    ? C.assignShortNames(
        ticked.map((r) => ({ name: r.name, first: r.first, last: r.last })),
        existingNames,
      )
    : ticked.map((r) => r.name);
  return { rows, saved: C.ensureDistinctNames(shown, existingNames) };
}

const distinctly = (names) =>
  assert.equal(new Set(names.map(C.nameKey)).size, names.length, `not all distinct: ${names}`);

test("five students who all shorten alike all arrive, under five different names", () => {
  // The bug, exactly as reported. Before this change the review list showed
  // two rows -- Maria Garcia and Jose Hernandez -- and three children were
  // gone, with nothing on the screen to say so.
  const result = importFile("short-name-collisions.csv");
  assert.deepEqual(justNames(result), [
    "Maria Garcia",
    "Maria Gonzalez",
    "Maria Guzman",
    "Jose Hernandez",
    "Jose Herrera",
  ]);

  const { rows, saved } = reviewAndSave(result.names);
  assert.equal(rows.length, 5, "every child reaches the teacher, switch on");
  assert.deepEqual(saved, [
    "Maria Ga.",
    "Maria Go.",
    "Maria Gu.",
    "Jose Hern.",
    "Jose Herr.",
  ]);
  distinctly(saved);

  // The whole group moves together. "Maria G." beside "Maria Go." reads as a
  // mistake somebody made, and the Joses needed four letters before Hernandez
  // and Herrera parted company.
  assert.ok(!saved.includes("Maria G."));

  // With the switch off nothing was ever wrong, and nothing changes.
  assert.deepEqual(reviewAndSave(result.names, [], false).saved, justNames(result));
});

test("an enrolled 'Maria G.' does not swallow Maria Gonzalez", () => {
  const imported = [{ name: "Maria Gonzalez", first: "Maria", last: "Gonzalez" }];
  const enrolled = ["Maria G."];
  const { rows, saved } = reviewAndSave(imported, enrolled);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].existing, false, "ticked, not written off as already here");
  assert.equal(rows[0].possibleMatch, "Maria G.", "with the doubt shown to the teacher");

  assert.deepEqual(saved, ["Maria Go."]);
  distinctly([...enrolled, ...saved]);
  assert.deepEqual(enrolled, ["Maria G."], "and the student already here is untouched");
});

test("two children of the same name are two children; one child listed twice is one", () => {
  // These two cases look identical in the name column and are told apart only
  // by the columns this app refuses to keep. The file with a Student ID has
  // evidence that row two is a different girl, so she is kept and numbered --
  // a number is ugly, and losing a child off the roster is worse. The file
  // with nothing but names has no such evidence, so a repeated name is read as
  // the office listing one child twice and collapses. See extractNames: the
  // other columns are compared inside it and thrown away, and all that comes
  // out is which of them this is.
  const namesakes = importFile("namesakes.csv");
  assert.equal(namesakes.names.length, 3);
  const { rows, saved } = reviewAndSave(namesakes.names);
  assert.equal(rows.length, 3, "nothing merged");
  assert.deepEqual(saved, ["Maria Garcia", "Maria Garcia 2", "Jose H."]);
  distinctly(saved);

  // Same name, no distinguishing column, three rows: one child.
  const repeated = importFile("duplicates.csv");
  assert.equal(repeated.names.length, 4, "the file really does repeat her");
  assert.deepEqual(reviewAndSave(repeated.names).rows.map((r) => r.name), [
    "Amelia Rivera",
    "Benjamin Okafor",
  ]);
});

test("Jr, Sr and the regnal numbers are not a surname", () => {
  assert.equal(C.shortenName("John Smith Jr."), "John S.");
  assert.equal(C.shortenName("Smith Jr., John"), "John S.");
  assert.equal(C.shortenName("John Smith Jr"), "John S.");
  assert.equal(C.shortenName("Marcus Aurelius III"), "Marcus A.");
  assert.equal(C.shortenName("Henry Tudor IV"), "Henry T.");
  // Not "V": a last initial is one letter, so a bare V has to stay a surname
  // or "Maria V." -- a name this app writes itself -- comes back as "Maria".
  assert.equal(C.shortenName("Maria V."), "Maria V.");
});

test("a two-part surname is shortened from the column the school put it in", () => {
  // Re-splitting "Jose Luis Hernandez Lopez" gives "Jose L." -- his middle
  // name -- or "Jose L." for Lopez, depending which end you start from. The
  // Last column says Hernandez Lopez, so the answer is H., and it is his.
  const rows = R.parseDelimited(
    "First Name,Last Name\nJose Luis,Hernandez Lopez\nMaria,de la Cruz\n",
  );
  const { names } = R.extractNames(R.planImport(rows));
  assert.deepEqual(justNames({ names }), ["Jose Luis Hernandez Lopez", "Maria de la Cruz"]);
  assert.deepEqual(names.map((n) => [n.first, n.last]), [
    ["Jose Luis", "Hernandez Lopez"],
    ["Maria", "de la Cruz"],
  ]);
  assert.deepEqual(reviewAndSave(names).saved, ["Jose Luis H.", "Maria D."]);

  // And with only a joined name to go on, the old reading is all there is.
  assert.equal(C.shortenName("Jose Luis Hernandez Lopez"), "Jose L.");
});

test("an import never renames a student who is already in the class", () => {
  // A student who has been "Maria G." all term stays "Maria G." -- her name is
  // on her work, in her parents' emails and in every report already sent. The
  // import works around her.
  const enrolled = ["Maria G.", "Jose H.", "Amelia Rivera"];
  const before = [...enrolled];
  const imported = [
    { name: "Maria Guzman", first: "Maria", last: "Guzman" },
    { name: "Jose Herrera", first: "Jose", last: "Herrera" },
  ];
  const { saved } = reviewAndSave(imported, enrolled);
  assert.deepEqual(enrolled, before, "the class list is not rewritten");
  distinctly([...enrolled, ...saved]);
  assert.ok(!saved.includes("Maria G.") && !saved.includes("Jose H."));
});

test("the save path numbers a clash rather than shortening it again", () => {
  // ensureDistinctNames is the last guard, and it must not re-shorten: by the
  // time a name reaches it the review list may already have made it
  // "Maria Ga.", and running the shortener over that gives "Maria G." back --
  // undoing the entire fix at the final step.
  assert.deepEqual(C.ensureDistinctNames(["Maria Ga."], ["Maria G."]), ["Maria Ga."]);
  assert.deepEqual(C.ensureDistinctNames(["Maria G."], ["Maria G."]), ["Maria G. 2"]);
  assert.deepEqual(C.ensureDistinctNames(["Ann B.", "Ann B."], []), ["Ann B.", "Ann B. 2"]);
});

test("the review list and the save path are the ones that use it", () => {
  // The functions above are only worth anything if the screen calls them. A
  // pure module proved correct beside a component that still shortens each
  // name on its own is exactly the shape the bug had.
  const scanner = fs.readFileSync(path.join(ROOT, "components/teacher-classes.tsx"), "utf8");
  assert.match(scanner, /assignShortNames\(/, "the review list names everyone at once");
  assert.ok(
    !/buildReviewRows\([^)]*,\s*short\s*\)/.test(scanner),
    "and identity no longer depends on the shorten switch",
  );
  assert.match(scanner, /\[r\.key\]/, "rows are keyed by identity, not by name");

  const insights = fs.readFileSync(path.join(ROOT, "components/teacher-insights.tsx"), "utf8");
  assert.match(insights, /ensureDistinctNames\(/, "and the save has the last word");

  // The other way a class gains two students under one name.
  const scan = fs.readFileSync(path.join(ROOT, "lib/teacher-class-scan.ts"), "utf8");
  assert.match(scan, /ensureDistinctNames\(/, "a scan may not create a second 'Maria G.' either");
});

// ---------------------------------------------------------------
// The file never leaves the computer
// ---------------------------------------------------------------

test("nothing in the import path can upload, fetch or call a model", () => {
  const strip = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const file of ["lib/roster-import.ts", "lib/roster-file.ts"]) {
    const code = strip(fs.readFileSync(path.join(ROOT, file), "utf8"));
    for (const forbidden of ["fetch(", "FormData", "/api/", "analyzeRequest", "XMLHttpRequest"])
      assert.ok(!code.includes(forbidden), `${file} must not contain ${forbidden}`);
  }
});

test("the Excel reader is loaded lazily, so it stays out of the main bundle", () => {
  const src = fs.readFileSync(path.join(ROOT, "lib/roster-file.ts"), "utf8");
  assert.ok(
    /await import\("read-excel-file\/browser"\)/.test(src),
    "dynamic import, of the subpath that actually exists -- the package exports no \".\" entry",
  );
  assert.ok(
    !/^import .*read-excel-file/m.test(src),
    "and never a static one, which would put a zip and XML parser in every page",
  );
  // The package the prompt warns about, by name.
  assert.ok(!/from "xlsx"|require\("xlsx"\)/.test(src));
});
