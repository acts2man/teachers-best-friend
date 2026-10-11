// A class scan started on the phone shows on the computer, and the other way
// round (Michael, 7 Oct: scanned on his Android, opened Windows, saw nothing).
// These pin the rules that decide what each device shows when both have
// changed the scan: no page is ever dropped, the device that got further in
// grading wins, and a stack is never graded twice at once.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { readFileSync, existsSync } from "node:fs";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const shim = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(shim, shim.exports);
  return shim.exports;
}
const S = bundle("lib/scan-session.ts");
const C = bundle("lib/teacher-class-scan.ts");

const page = (id) => ({ key: "k" + id, label: "Page", bodyId: id, stripId: "n" + id, pages: 1 });
const session = (over) => ({ ...S.EMPTY_SESSION, ...over });

test("a page only one device has survives the merge", () => {
  const server = session({ piles: [[page("a"), page("b")], [page("c")]] });
  const local = session({ piles: [[page("a"), page("b")], [page("c"), page("d")], [page("e")]] });
  const merged = S.mergeSessions(server, local);
  assert.deepEqual(merged.piles.map((p) => p.map((x) => x.bodyId)), [["a", "b"], ["c", "d"], ["e"]],
    "d joins the student it was scanned with; e keeps its own pile");
});

test("pages from both devices are all kept, the server's first", () => {
  const server = session({ piles: [[page("a")], [page("s1")]] });
  const local = session({ piles: [[page("a")], [page("p1")]] });
  const ids = S.mergeSessions(server, local).piles.flat().map((x) => x.bodyId);
  assert.deepEqual(ids.sort(), ["a", "p1", "s1"]);
});

test("the open pile stays last when local pages are added", () => {
  const server = session({ piles: [[page("a")], []] });
  const local = session({ piles: [[page("x")]] });
  const merged = S.mergeSessions(server, local);
  assert.deepEqual(merged.piles.map((p) => p.map((x) => x.bodyId)), [["a"], ["x"], []]);
});

test("grading progress goes to whichever device got further", () => {
  const server = session({ piles: [[page("a")]], progress: { graded: [], nextBatch: 1, scanId: null } });
  const local = session({ piles: [[page("a")]], progress: { graded: [], nextBatch: 3, scanId: null } });
  assert.equal(S.mergeSessions(server, local).progress.nextBatch, 3);
  assert.equal(S.mergeSessions(local, server).progress.nextBatch, 3);
});

test("name matching on the account wins over a device still scanning", () => {
  const groups = [{ key: "group-0", pageUploadIds: ["a"], candidateIds: [], responses: [] }];
  const server = session({ piles: [[page("a")]], groups, pageUploadIds: ["a"], discarded: ["group-0"] });
  const local = session({ piles: [[page("a")]], progress: { graded: [], nextBatch: 1, scanId: null } });
  const merged = S.mergeSessions(server, local);
  assert.equal(merged.groups.length, 1);
  assert.equal(merged.progress, null, "graded is graded");
  assert.deepEqual(merged.discarded, ["group-0"]);
  assert.equal(S.sessionStep(merged), "matching");
});

test("another device's grading blocks this one until it goes quiet", () => {
  const now = 1_000_000;
  const s = session({ piles: [[page("a")]], grading: { device: "phone", at: now - 30_000 } });
  assert.equal(S.gradingElsewhere(s, "computer", now), true);
  assert.equal(S.gradingElsewhere(s, "phone", now), false, "its own note never blocks it");
  assert.equal(S.gradingElsewhere(s, "computer", now + S.GRADING_STALE_MS), false,
    "a phone that slept mid-grade does not strand the scan");
});

test("the stale window is a tight multiple of the heartbeat, not two minutes", () => {
  // A device grading refreshes every GRADING_HEARTBEAT_MS; the stale window must
  // clear two missed beats so a device still grading is never judged stopped,
  // but stay well under the old two minutes so moving to another device resumes
  // soon (Ricky: "leaving the screen stops grading").
  assert.ok(S.GRADING_STALE_MS >= 2 * S.GRADING_HEARTBEAT_MS, "survives two missed beats");
  assert.ok(S.GRADING_STALE_MS <= 90_000, "but a moved-away device frees up quickly");
});

test("releaseGrading frees this device's note so the other can resume at once", () => {
  const now = 1_000_000;
  const s = session({ piles: [[page("a")]], grading: { device: "phone", at: now } });
  const freed = S.releaseGrading(s, "phone");
  assert.equal(freed.grading, null, "the phone's own note is cleared when it leaves");
  assert.equal(S.gradingElsewhere(freed, "computer", now), false, "the computer can resume immediately");
  // Another device's note is left alone, and nothing else about the session moves.
  assert.equal(S.releaseGrading(s, "computer").grading.device, "phone");
  assert.deepEqual(S.releaseGrading(s, "phone").piles, s.piles);
});

test("scanPollMs checks faster while a scan is being worked, slower when idle", () => {
  const active = session({ piles: [[page("a")]], grading: { device: "phone", at: 1 } });
  const scanning = session({ piles: [[page("a")]] });
  const matching = session({ piles: [[page("a")]], groups: [{ pageIndexes: [0], name: "x", responses: [], pageUploadIds: ["a"], detectedName: "x", confidence: 0, studentId: null, candidateIds: [], matchConfidence: 0, suggestedId: null, nameUploadId: null, nameBox: null, key: "g0" }] });
  assert.equal(S.scanPollMs(active), 4000, "grading in flight -> fast");
  assert.equal(S.scanPollMs(scanning), 4000, "scanning in flight -> fast");
  assert.equal(S.scanPollMs(matching), 15000, "waiting on the teacher to match -> idle");
  assert.equal(S.scanPollMs(null), 15000, "nothing known yet -> idle");
});

test("a session read back from the server is validated, not trusted", () => {
  assert.equal(S.parseSession(null), null);
  assert.equal(S.parseSession({ piles: "nope" }), null, "nothing usable");
  const s = S.parseSession({ piles: [[page("a"), { junk: 1 }]], progress: { graded: [], nextBatch: -1 } });
  assert.deepEqual(s.piles[0].map((x) => x.bodyId), ["a"]);
  assert.equal(s.progress, null, "a nonsense progress is dropped");
  assert.equal(S.sessionStep(s), "scanning");
});

test("batches are filled by size as well as by page count", () => {
  // Twelve 1.2 MB pages would be 14.4 MB: over the route's 12 MB refusal.
  const groups = Array.from({ length: 12 }, (_, i) => [i]);
  const ids = groups.map((_, i) => "u" + i);
  const bytes = ids.map(() => 1.2 * 1024 * 1024);
  const batches = C.planScanBatches(groups, ids, 1, undefined, undefined, bytes);
  for (const b of batches) {
    const total = b.groups.flat().length * 1.2 * 1024 * 1024;
    assert.ok(total <= C.MAX_BATCH_BYTES, "a batch of " + (total / 1048576).toFixed(1) + " MB");
  }
  assert.equal(batches.flatMap((b) => b.groupIndexes).length, 12, "every student still graded");
  // Real whole pages (avg 383 KB, 8 Oct) still go twelve at a time.
  const real = C.planScanBatches(groups, ids, 1, undefined, undefined, ids.map(() => 383 * 1024));
  assert.equal(real.length, 1);
});

test("the account copy is wired in: route, table, and the panel", () => {
  assert.ok(existsSync("app/api/scans/session/route.ts"));
  const route = readFileSync("app/api/scans/session/route.ts", "utf8");
  assert.match(route, /\.eq\("revision", baseRevision\)/, "writes are conditional on the revision");
  assert.match(route, /status: 409/);
  const sql = readFileSync("supabase/migrations/20261008170000_class_scan_sessions.sql", "utf8");
  assert.match(sql, /on delete cascade/);
  assert.match(sql, /expires_at/);
  assert.match(sql, /enable row level security/);
  const ui = readFileSync("components/teacher-class-scan.tsx", "utf8");
  assert.match(ui, /useScanSession\(/);
  assert.match(ui, /gradingElsewhere\) return;/, "no auto-resume while the other device grades");
  assert.match(ui, /void sync\.clear\(\)/, "saving the class clears it everywhere");
});

test("the camera strip holds thumbnails, not full photos", () => {
  // Michael's Android slowed around student 15: every 46px thumbnail decoded
  // the full ~2000px photo, ~12 MB each, held for every page in the set.
  const cam = readFileSync("components/scan-camera.tsx", "utf8");
  assert.match(cam, /export const THUMB_W = 96/);
  assert.match(cam, /const url = URL\.createObjectURL\(small \?\? blob\)/);
  assert.ok(!/url: URL\.createObjectURL\(s\.blob\)/.test(cam), "restored pages use thumbnails too");
  assert.match(cam, /release\(canvas\)/, "the full-size capture canvas is freed after encoding");
});
