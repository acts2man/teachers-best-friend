// #124 review, follow-up c: event messages could carry a student's name in
// unquoted text ("Student Maria Lopez not found"), and short free strings in
// detail. Proven when: no name-like word in a message or detail string reaches
// a stored row, while the error itself stays readable. Names are placeholders.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const r = buildSync({ entryPoints: ["lib/app-events.ts"], bundle: true, platform: "node", format: "cjs", write: false });
const m = { exports: {} };
new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
const { scrubEventText, scrubDetail, clientEventSchema } = m.exports;

const NAMES = ["Maria", "MARIA", "Lopez", "LOPEZ", "Avery", "Quinn", "Montgomery-Fitzgerald", "Jose", "maria", "Hope", "deShawn", "mcKenzie", "May", "maria-lopez", "lopez.m", "Lopez", "Smith", "garcia"];

test("unquoted names are removed from messages", () => {
  for (const msg of [
    "Student Maria Lopez not found",
    "Could not match Avery Quinn to the roster",
    "Montgomery-Fitzgerald page 2 failed to upload",
    "name read failed for maria",
    "Hope Always is not a student",
    // Round-2 review: the shapes that still got through.
    "Student not found: Maria.",
    "No roster match for MARIA LOPEZ",
    "student:Maria Maria_Lopez Maria/Lopez [Maria] <Maria> #Maria name=Maria",
    "deShawn mcKenzie MariaError MariaLopezException",
    "Could not read Maria's page in May",
    "see https://app.example/x?student=Maria%20Lopez",
    // Round 3.
    "Student maria.lopez not found (maria.lopez) student.maria lopez.m maria()",
    "Failed /students/maria-lopez and https://x.app/roster/maria-lopez#x",
    // Round 4.
    "M.Lopez not found Student M.Lopez. J.Smith JL.Smith x.Maria jo.garcia a.maria",
  ]) {
    const out = scrubEventText(msg);
    for (const n of NAMES) assert.ok(!out.includes(n), `"${msg}" -> "${out}" still has ${n}`);
  }
});

test("the error itself stays readable", () => {
  assert.equal(scrubEventText("TypeError: Cannot read properties of undefined (reading 'length')"), "TypeError: Cannot read properties of undefined (reading \"…\")");
  assert.equal(scrubEventText("Failed to fetch"), "Failed to fetch");
  assert.equal(scrubEventText("class_scan: short"), "class_scan: short");
  assert.equal(scrubEventText("Unexpected token < in JSON at position 0"), "Unexpected token < in JSON at position 0");
  assert.match(scrubEventText("ChunkLoadError: Loading chunk 812 failed."), /^ChunkLoadError: Loading chunk 812 failed\.$/);
});

test("an endpoint in detail is templated on the server too", () => {
  assert.deepEqual(scrubDetail({ endpoint: "/api/students/maria-lopez-123456" }), { endpoint: "/api/students/:id" });
});

test("detail keeps numbers, booleans and fixed-shape strings only", () => {
  assert.deepEqual(scrubDetail({ mode: "class_scan", kind: "short", batch: 2, retried: true }), { mode: "class_scan", kind: "short", batch: 2, retried: true });
  assert.deepEqual(scrubDetail({ status: 500, method: "PUT", endpoint: "/api/workspace" }), { status: 500, method: "PUT", endpoint: "/api/workspace" });
  assert.deepEqual(scrubDetail({ model: "gpt-5.6-luna", effort: "medium" }), { model: "gpt-5.6-luna", effort: "medium" });
  // A name in any string -- under an unknown key, or in a known key with the wrong shape -- is dropped.
  assert.deepEqual(scrubDetail({ student: "maria", kind: "Maria Lopez", batch: 1 }), { batch: 1 });
  assert.equal(scrubDetail({ who: "Avery" }), null);
});

test("the browser's events go through the same rules on the server", () => {
  const e = clientEventSchema.parse({ type: "client_error", message: "Student Maria Lopez not found", detail: { student: "maria", status: 404 } });
  assert.ok(!/Maria|Lopez/.test(e.message));
  assert.deepEqual(e.detail, { status: 404 });
});

test("real error text stays useful (round-3 review)", () => {
  assert.match(scrubEventText("Error: Minified React error #418; visit https://react.dev/errors/418?args[]=x"), /#418/);
  assert.equal(scrubEventText("sync_workspace failed: 500"), "sync_workspace failed: 500");
  assert.equal(scrubEventText("NotReadableError: Could not start video source"), "NotReadableError: Could not start video source");
  assert.equal(scrubEventText("e.map is not a function"), "e.map is not a function");
  assert.equal(scrubEventText("This classroom changed in another tab. Reload to see the latest version before saving."), "This classroom changed in another tab. Reload to see the latest version before saving.");
  assert.deepEqual(scrubDetail({ endpoint: "/api/students/maria-lopez" }), { endpoint: "/api/students/:seg" });
});

// ---- #128 round 3 -----------------------------------------------------------
// 3a. scrubStack kept any line with "@", ":N:N" or a leading "at ". Verified
// leaks: "Maria Lopez came at 12:30:45", "maria@school.org", and URLs inside
// stack lines not reduced to route templates. Only real code-location frames
// are kept now, and a URL in one is a route template unless it is build output.
const { scrubStack, routeTemplate } = m.exports;

test("3a: lines that only look like frames are dropped", () => {
  const stack = [
    "TypeError: x is undefined",
    "Maria Lopez came at 12:30:45",
    "maria@school.org",
    "at Maria Lopez",
    "    at the end of the day 1:2:3",
    "Maria@school.org:1:2 extra",
    "at Maria (Lopez)",
  ].join("\n");
  const out = scrubStack(stack);
  for (const n of ["Maria", "Lopez", "maria", "school", "day"]) assert.doesNotMatch(out, new RegExp(n), out);
});

test("3a: URLs in frames are route templates; build output keeps its file names", () => {
  const stack = [
    "Error: boom",
    "    at onClick (https://app.example/students/maria-lopez?name=Maria:10:5)",
    "    at https://app.example/assessments/1a54469a-06b9-42e3-879e-bc55714ea0aa/maria:1:1",
    "render@https://app.example/students/maria-lopez:3:4",
    "    at commit (https://app.example/_next/static/chunks/app/assessments/page-3f9a1c.js?v=1:12:34)",
    "    at async Promise.all (index 0)",
    "    at Array.map (<anonymous>)",
    "    at new Foo (webpack-internal:///./lib/foo.ts:5:6)",
    "    at Object.<anonymous> (/var/task/.next/server/chunks/123.js:7:8)",
    "    at node:internal/process/task_queues:95:5",
    "Gt/<@https://app.example/_next/static/chunks/main-abc.js:1:2",
  ].join("\n");
  const out = scrubStack(stack);
  assert.doesNotMatch(out, /maria|Maria|name=/, out);
  assert.match(out, /onClick \(\/students\/:seg:10:5\)/);
  assert.match(out, /\/assessments\/:id\/:seg:1:1/);
  assert.match(out, /render \(\/students\/:seg:3:4\)/);
  assert.match(out, /commit \(\/_next\/static\/chunks\/app\/assessments\/page-3f9a1c\.js:12:34\)/);
  assert.match(out, /Array\.map \(<anonymous>\)/);
  assert.match(out, /Object\.<anonymous> \(\/\.next\/server\/chunks\/123\.js:7:8\)/);
  assert.match(out, /node:internal\/process\/task_queues:95:5/);
  assert.match(out, /^at Gt\/< \(\/_next\/static\/chunks\/main-abc\.js:1:2\)$/m);
  assert.equal(routeTemplate("/students/maria-lopez"), "/students/:seg");
});

// 3b. detail.kind, detail.mode and detail.effort took any lower-case word
// (detail:{kind:"maria"} was stored). Each is now checked against a fixed list.
test("3b: kind, mode and effort only from fixed lists", () => {
  assert.equal(scrubDetail({ kind: "maria" }), null);
  assert.equal(scrubDetail({ mode: "lopez" }), null);
  assert.equal(scrubDetail({ effort: "maria" }), null);
  assert.deepEqual(scrubDetail({ mode: "class_scan", kind: "short_parts", effort: "high", batch: 2 }), { mode: "class_scan", kind: "short_parts", effort: "high", batch: 2 });
  for (const kind of ["error", "timeout", "unparseable", "short", "incomplete", "empty", "short_parts"]) assert.deepEqual(scrubDetail({ kind }), { kind });
  for (const effort of ["none", "minimal", "low", "medium", "high"]) assert.deepEqual(scrubDetail({ effort }), { effort });
});

test("3b: the mode list is exactly the AI modes the analyze route accepts", async () => {
  const { DETAIL_MODES } = m.exports;
  const a = buildSync({ entryPoints: ["lib/analyze-shared.ts"], bundle: true, platform: "node", format: "cjs", write: false, external: ["pdfjs-dist/legacy/build/pdf.mjs"], alias: { "server-only": process.cwd() + "/tests/fixtures/empty-module.cjs" } });
  const am = { exports: {} };
  new Function("module", "exports", "require", a.outputFiles[0].text)(am, am.exports, require);
  assert.deepEqual([...DETAIL_MODES].sort(), [...am.exports.analyzeInput.shape.mode.options].sort());
});

test("3b: every kind the app's own code sends is on the list", () => {
  const { DETAIL_KINDS } = m.exports;
  const src = ["lib/app-events-server.ts", "components/teacher-class-scan.tsx"].map((f) => require("node:fs").readFileSync(f, "utf8")).join("\n");
  const sent = new Set([...src.matchAll(/kind: "([a-z_]+)"/g)].map((x) => x[1]));
  const declared = /AiFailureKind = ([^;]+);/.exec(src)[1].match(/"([a-z_]+)"/g).map((x) => x.slice(1, -1));
  for (const k of [...sent, ...declared]) assert.ok(DETAIL_KINDS.has(k), k);
});

// ---- #128 round-3 review ----------------------------------------------------
// The browser scrubs a stack before sending it and the server scrubs it again;
// the first round-3 parser rejected its own output, so every browser stack was
// stored empty. And real frames were dropped: Chrome's "[as onclick]" alias
// (often the frame that threw), eval frames, Safari's "global code".
const REAL = [
  "TypeError: Cannot read properties of undefined (reading 'x')",
  "    at Object.render [as current] (https://tbf.app/_next/static/chunks/app/assessments/page-3f2a.js:1:2345)",
  "    at HTMLButtonElement.callCallback [as onclick] (https://tbf.app/_next/static/chunks/main-app.js:9:10)",
  "    at async Promise.all (index 0)",
  "    at eval (eval at compile (https://tbf.app/_next/static/chunks/x.js:1:2), <anonymous>:3:9)",
  "    at /var/task/.netlify/dist/run/handlers/server.js:12:3",
  "global code@https://tbf.app/_next/static/chunks/y.js:1:2",
  "promiseReactionJob@[native code]",
  "fn/<@https://tbf.app/_next/static/chunks/z.js line 2 > eval:1:5",
].join("\n");

test("review: real Chrome, Safari, Firefox and server frames are kept", () => {
  const out = scrubStack(REAL).split("\n");
  assert.deepEqual(out, [
    "at Object.render (/_next/static/chunks/app/assessments/page-3f2a.js:1:2345)",
    "at HTMLButtonElement.callCallback (/_next/static/chunks/main-app.js:9:10)",
    "at async Promise.all (index 0)",
    "at eval (/_next/static/chunks/x.js:1:2)",
    "at /.netlify/dist/run/handlers/server.js:12:3",
    "at global code (/_next/static/chunks/y.js:1:2)",
    "at promiseReactionJob ([native code])",
    "at fn/< (/_next/static/chunks/z.js:1:5)",
  ]);
});

test("review: scrubbing twice changes nothing -- the server's second pass keeps the browser's frames", () => {
  for (const stack of [REAL, "Error: x\n    at onClick (https://app.example/students/maria-lopez?name=Maria:10:5)\nrender@https://app.example/_next/static/chunks/a.js:3:4"]) {
    const once = scrubStack(stack);
    assert.ok(once.length > 0);
    assert.equal(scrubStack(once), once);
  }
});

test("review: a stack sent from the browser survives the server's validation", () => {
  const { clientEventsBody } = m.exports;
  const parsed = clientEventsBody.parse({
    sessionId: "abcdef12-3456",
    events: [{ type: "client_error", message: "x", stack: scrubStack(REAL), route: "/assessments", viewportW: 390, viewportH: 844, build: "53d3e56" }],
  });
  assert.equal(parsed.events[0].stack.split("\n").length, 8);
});

test("review: no quadratic blow-up on hostile input", () => {
  const evil = "at " + "a (".repeat(5000) + "x";
  const t = Date.now();
  for (let i = 0; i < 10; i++) scrubStack(Array(10).fill(evil).join("\n"));
  assert.ok(Date.now() - t < 200, "10 x 10 hostile lines in " + (Date.now() - t) + "ms");
  const long = Array.from({ length: 40 }, () => "at f (" + "(".repeat(590) + ")").join("\n");
  const t2 = Date.now();
  scrubStack(long);
  assert.ok(Date.now() - t2 < 100);
});

test("review: node: locations and build paths are restricted", () => {
  assert.equal(scrubStack("at node:Maria Lopez:1:2"), "");
  assert.equal(scrubStack("at node:internal/process/task_queues:95:5"), "at node:internal/process/task_queues:95:5");
  assert.equal(scrubStack("at x (/_next/static/Maria+Lopez.js:1:2)"), "at x (/_next/static/:seg:1:2)");
});
