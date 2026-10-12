// app_events must say what broke, where, on which device and build -- and must
// never carry a student's name or answer. These run the real lib/app-events.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, (id) => require(id));
  return m.exports;
}
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ev = bundle("lib/app-events.ts");

test("quoted text, emails and long numbers are scrubbed out of messages", () => {
  const out = ev.scrubEventText(`Unexpected token in JSON at "Maria Gonzalez wrote 2x+4" from 'x=5' by teacher@example.org id 1234567890`);
  assert.doesNotMatch(out, /Maria|Gonzalez|2x\+4|x=5|teacher@example|1234567890/);
  assert.match(out, /Unexpected token in JSON/);
});

test("messages are capped", () => {
  assert.ok(ev.scrubEventText("a ".repeat(2000)).length <= 500);
});

test("a stack keeps code locations and drops the message line", () => {
  const stack = `TypeError: Cannot read properties of undefined (reading "Maria")\n    at render (https://app.example/_next/static/chunks/page.js?v=abc:12:34)\n    at commit (https://app.example/_next/static/chunks/main.js:1:2)`;
  const out = ev.scrubStack(stack);
  assert.doesNotMatch(out, /Maria|TypeError/);
  assert.match(out, /page\.js:12:34/);
  assert.doesNotMatch(out, /\?v=abc/, "query strings dropped");
});

test("routes are templates: no query string, ids replaced", () => {
  assert.equal(ev.routeTemplate("https://x.test/assessments?id=1a54469a-06b9-42e3-879e-bc55714ea0aa&tab=responses"), "/assessments");
  assert.equal(ev.routeTemplate("/api/analyze/1a54469a-06b9-42e3-879e-bc55714ea0aa"), "/api/analyze/:id");
  assert.equal(ev.routeTemplate("/scan"), "/scan");
});

test("device class follows the viewport, with the user agent as tie-break", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
  const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  assert.equal(ev.deviceClass(390, iphone), "phone");
  assert.equal(ev.deviceClass(412, android), "phone");
  assert.equal(ev.deviceClass(1366, windows), "desktop");
  assert.equal(ev.browserName(iphone), "Safari 18 / iOS");
  assert.equal(ev.browserName(android), "Chrome 131 / Android");
  assert.equal(ev.browserName(windows), "Chrome 131 / Windows");
});

test("the server re-validates: free text in detail is refused, strings are scrubbed", () => {
  const ok = ev.clientEventsBody.safeParse({
    sessionId: "abcdef12-3456",
    events: [{ type: "client_error", message: `bad "Student Name"`, route: "/students?id=123456789", viewportW: 390, viewportH: 844, build: "53d3e56" }],
  });
  assert.ok(ok.success);
  const row = ev.eventRow(ok.data.events[0], { teacherId: "t", sessionId: "abcdef12-3456", serverBuild: "" });
  assert.doesNotMatch(row.message, /Student Name/);
  assert.equal(row.route, "/students");
  assert.equal(row.viewport_w, 390);
  assert.equal(row.build_commit, "53d3e56");
  assert.equal(row.device_class, "phone");
  const bad = ev.clientEventsBody.safeParse({
    sessionId: "abcdef12-3456",
    events: [{ type: "client_error", detail: { answer: "the student wrote: x = 5!" } }],
  });
  assert.equal(bad.success, false, "a sentence in detail is not accepted");
  assert.equal(ev.clientEventsBody.safeParse({ sessionId: "abcdef12-3456", events: [{ type: "made_up" }] }).success, false);
});

test("the app shell installs the logger and the class scan logs short AI batches", () => {
  assert.match(readFileSync("components/teacher-app.tsx", "utf8"), /installAppEventLogging\(\)/);
  assert.match(readFileSync("components/teacher-class-scan.tsx", "utf8"), /logAppEvent\("ai_failure"/);
});

test("the analyze routes log every AI failure path", () => {
  const route = readFileSync("app/api/analyze/route.ts", "utf8");
  assert.equal((route.match(/logAiFailure\(/g) || []).length, 2, "background start + synchronous call");
  const poll = readFileSync("app/api/analyze/[scanId]/route.ts", "utf8");
  assert.equal((poll.match(/logAiFailure\(/g) || []).length, 4, "poll failed, stopped, empty, unparseable");
});

test("the migration lets a teacher insert their own events and read none", () => {
  const sql = readFileSync("supabase/migrations/20261012190000_app_events_and_regression_replay.sql", "utf8");
  assert.match(sql, /create policy "Teachers log their own events" on public\.app_events\s+for insert to authenticated\s+with check \(teacher_id = \(select auth\.uid\(\)\)\)/);
  assert.doesNotMatch(sql, /on public\.app_events\s+for (select|update|delete|all)/i);
  assert.match(sql, /grant insert on public\.app_events to authenticated/);
  assert.match(sql, /create trigger app_events_rate_limit before insert on public\.app_events/);
});
