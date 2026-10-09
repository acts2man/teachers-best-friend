// PR2: a blank test (and the answer key) should read once, after all pages are
// in -- not after every page.
//
// Ricky photographed a blank test a page at a time; the app read after each
// page, and each read re-read the pages before it. Student work never did this:
// it collects every page in the in-app camera, then reads once when the teacher
// taps a button. The blank test and the answer key now work the same way.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scan = readFileSync("components/teacher-scan.tsx", "utf8");
const key = readFileSync("components/teacher-answer-key.tsx", "utf8");

// ---------------------------------------------------------------
// Blank test: collect, then one read
// ---------------------------------------------------------------

test("uploading a blank-test page no longer triggers a read", () => {
  // The per-upload auto-read is gone; upload() only uploads.
  assert.doesNotMatch(scan, /if \(!failed && uploadedIds\.length && autoReads\)/);
  // And it does not call analyze from inside upload() at all.
  const uploadBody = scan.slice(
    scan.indexOf("async function upload("),
    scan.indexOf("function makeAssessment("),
  );
  assert.doesNotMatch(uploadBody, /analyze\(/, "upload() must not read");
});

test("the in-app camera collects all pages, then upload stores them for one read", () => {
  // Done hands back every captured page in one upload call (one group flattened).
  assert.match(scan, /const captured = groups\.flat\(\);/);
  assert.match(scan, /if \(captured\.length\) upload\(captured\)/);
});

test("a single read button reads the whole set at once", () => {
  // The button reads with no ids, so analyze reads every uploaded page together.
  assert.match(scan, /onClick=\{\(\) => analyze\(undefined, true, true\)\}/);
  assert.match(scan, /const uploadIds = ids \?\? files\.map\(\(f\) => f\.id\)/);
  // Label is "Read the assessment" before the first read, "Read it again" after.
  assert.match(scan, /hasRead\s*\n?\s*\? "Read it again"\s*\n?\s*: "Read the assessment"/);
});

test("multi-page PDF upload still works through the same picker", () => {
  // The file input stays multiple + PDF, and upload() still uploads every file.
  assert.match(scan, /accept="application\/pdf,image\/jpeg,image\/png,image\/webp"/);
  assert.match(scan, /const uploaded = await Promise\.all\(prepped\.map\(\(f\) => uploadFile\(f\)\)\)/);
});

// ---------------------------------------------------------------
// Answer key: same pattern
// ---------------------------------------------------------------

test("uploading answer-key pages no longer auto-reads with AI", () => {
  // The old `if (aiReady) await readKey(ids)` on upload is gone; the teacher
  // taps "Read the key" once after all pages are in.
  assert.doesNotMatch(key, /if \(aiReady\) await readKey\(ids\)/);
  assert.match(key, /tap Read the key/);
});

test("the answer key reads once via a button, labelled for first vs repeat read", () => {
  assert.match(key, /onClick=\{\(\) => readKey\(undefined, true\)\}/);
  assert.match(key, /hasReadKey \? "Read again" : "Read the key"/);
});

test("the no-AI path still parses a typed PDF locally on upload", () => {
  // That is instant and free, so it stays on upload.
  assert.match(key, /else await readPdfFallback\(uploaded\)/);
});
