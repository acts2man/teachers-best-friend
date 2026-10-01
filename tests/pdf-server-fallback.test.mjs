// PR5: a PDF the browser cannot read must not stop the teacher.
//
// Michael uploaded a PDF the browser could not read and the flow stopped there.
// The client-side read is only a convenience: the file should upload and be read
// on the server instead, with a message only if that also comes back empty.
// safePdfText makes the browser read best-effort (it never throws), and every
// upload path now uses it so a decode failure cannot abort the upload.
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
    external: ["pdfjs-dist"],
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(
    m,
    m.exports,
    require,
  );
  return m.exports;
}

const { safePdfText } = bundle("lib/pdf-text.ts");

// ---------------------------------------------------------------
// safePdfText never throws
// ---------------------------------------------------------------

test("safePdfText returns empty string when the browser can't read the PDF", async () => {
  // Bytes that are not a decodable PDF: the reader rejects, and safePdfText
  // must swallow it so the caller keeps the upload rather than stopping.
  const out = await safePdfText(new ArrayBuffer(8));
  assert.equal(out, "");
});

// ---------------------------------------------------------------
// Every browser read goes through safePdfText, not a throwing read
// ---------------------------------------------------------------

const CALLERS = [
  "components/teacher-review.tsx",
  "components/teacher-scan.tsx",
  "components/teacher-classes.tsx",
];

for (const file of CALLERS) {
  test(`${file} uses the best-effort read so an upload can't be aborted`, () => {
    const src = readFileSync(file, "utf8");
    assert.match(src, /safePdfText\(/, "should call safePdfText");
    // The old throwing read must be gone from the upload loops.
    assert.doesNotMatch(
      src,
      /await extractPdfText\(/,
      "no direct extractPdfText in an upload path",
    );
  });
}

test("the uploaded-PDF reader is best-effort too", () => {
  const src = readFileSync("lib/pdf-text.ts", "utf8");
  // extractUploadedPdfText now routes through safePdfText.
  assert.match(src, /return safePdfText\(await response\.arrayBuffer\(\)\)/);
  // safePdfText wraps the real reader in a catch.
  assert.match(src, /export async function safePdfText[\s\S]*try[\s\S]*catch/);
});
