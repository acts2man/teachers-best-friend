// Background upload follow-ups (review of #188, 28 Oct 2026). Proven when:
//   (a) a page still uploading when the tab reloads (sent, not failed) comes
//       back: the scan screen picks it up with the failed ones, retries it at
//       once with recoverFirst, places it where its upload had started (or,
//       if its student had not started, in one new pile per camera student),
//       and never places a file a pile already holds;
//   (b) a failed page on one device blocks grading on the other: each device
//       saves its failed-page count with the synced scan session, merging
//       keeps every other device's count, and grading refuses while any
//       other device has one.
// scripts/browser-check/upload-reload.mjs drives both in a browser.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const store = bundle("lib/scan-store.ts");
const S = bundle("lib/scan-session.ts");
const panel = readFileSync("components/teacher-class-scan.tsx", "utf8");

const shot = (id, seq, extra = {}) => ({ id, assessmentId: "t", group: 0, seq, blob: null, ...extra });

test("(a) after a reload the scan screen picks up a page still uploading, as well as a failed one", () => {
  const all = [
    shot("never-sent", 1),
    shot("uploading", 2, { sent: true, placeAt: { pile: 1, index: 0, label: "p" } }),
    shot("failed", 3, { sent: true, failed: true, failedAt: { pile: 0, index: 2, label: "q" } }),
    shot("held", 4, { sent: true, failed: true }),
  ];
  assert.deepEqual(store.pagesToPickUp(all, new Set(["held"])).map((s) => s.id), ["uploading", "failed"]);
  // The camera still offers only what it never handed over, and failed pages nobody holds.
  assert.deepEqual(store.restorableShots(all, new Set(["held", "failed"])).map((s) => s.id), ["never-sent"]);
});

test("(a) where a page is going is saved as its upload starts", () => {
  const land = panel.slice(panel.indexOf("async function landCameraStudent("), panel.indexOf("/** Undo the last page"));
  assert.match(land, /markShotPlace\(id, \{ pile, index: added \+ i, label: files\[i\]\.name \|\| "Page" \}\)/);
  assert.ok(land.indexOf("markShotPlace(") < land.indexOf("await preparePage(raw)"), "before any upload");
});

test("(a) picked-up pages: placed where they were going, retried at once if they were uploading", () => {
  const i = panel.indexOf("// After a reload: camera pages");
  const effect = panel.slice(i, panel.indexOf("}, [a.id]);", i));
  assert.match(effect, /\.\.\.\(place \? \{\} : \{ cameraGroup: shot\.group \}\),/, "no place: its camera student");
  assert.match(effect, /uploading: !shot\.failed,/);
  assert.match(effect, /if \(!f\.uploading \|\| !live\) continue;[\s\S]*await retryRef\.current\(f\);/, "only the ones that were uploading");
  const retry = panel.slice(panel.indexOf("async function retryPage("), panel.indexOf("retryRef.current = retryPage;"));
  assert.match(retry, /preparePage\(failed\.file, \{ recoverFirst: true \}\)/);
  assert.match(retry, /if \(pilesNow\.current\.some\(\(pile\) => pile\.some\(\(p\) => p\.bodyId === prepared\.bodyId\)\)\) \{\s*dropFailed\(failed\);\s*return;/,
    "a file already in a pile is not placed again");
  assert.ok(retry.indexOf("p.bodyId === prepared.bodyId") < retry.indexOf("setPiles("), "checked before placing");
});

test("(a) a student with no pile yet gets one, shared by its pages", () => {
  assert.deepEqual(S.pileForNewStudent([[{ bodyId: "a" }], []]), { piles: [[{ bodyId: "a" }], []], pile: 1 }, "the empty open pile");
  assert.deepEqual(S.pileForNewStudent([[{ bodyId: "a" }]]), { piles: [[{ bodyId: "a" }], []], pile: 1 }, "else a new one");
  const retry = panel.slice(panel.indexOf("async function retryPage("), panel.indexOf("retryRef.current = retryPage;"));
  assert.match(retry, /let pile = newStudentPiles\.current\.get\(group\);/);
  assert.match(retry, /if \(other\.cameraGroup === group && other\.pile < 0 && other\.shotId\)\s*void markShotPlace\(other\.shotId, \{ pile, index: 0, label: other\.label \}\)/,
    "the student's other pages learn the pile, after a reload too");
});

const session = (extra = {}) => ({ v: 1, piles: [[]], progress: null, groups: null, discarded: [], pageUploadIds: [], grading: null, ...extra });

test("(b) the failed-page count rides with the scan session, per device", () => {
  const parsed = S.parseSession(session({ failed: { phone: 2, laptop: 0, "": 3, junk: "x", neg: -1 } }));
  assert.deepEqual(parsed.failed, { phone: 2 }, "real counts only");
  assert.ok(!S.isEmptySession(session({ failed: { phone: 1 } })), "a failed page alone keeps the session");
  assert.equal(S.failedElsewhere({ failed: { phone: 2, laptop: 1 } }, "laptop"), 2);
  assert.equal(S.failedElsewhere({ failed: { phone: 2 } }, "phone"), 0);
});

test("(b) merging keeps the other device's count and this device's own", () => {
  const server = session({ piles: [[{ key: "k", bodyId: "b1" }]], failed: { phone: 1, laptop: 3 } });
  const mine = session({ piles: [[{ key: "k", bodyId: "b1" }]], failed: { laptop: 0, phone: 0 } });
  // On the laptop: the phone's 1 stays (only the phone writes it); the laptop's 0 wins over the server's stale 3.
  assert.deepEqual(S.mergeSessions(server, mine, "laptop").failed, { phone: 1 });
  // On the phone, after leaving its page out: 0 is the phone's own.
  assert.equal(S.mergeSessions(server, mine, "phone").failed?.phone, undefined);
  const hook = readFileSync("components/use-scan-session.ts", "utf8");
  assert.equal((hook.match(/mergeSessions\(theirs, (state|mine), device\)/g) ?? []).length, 2, "both merges pass the device");
});

test("(b) grading refuses while another device has a failed page", () => {
  assert.match(panel, /failed: \{ \.\.\.remoteFailed, \[device\]: failedPages\.length \},/, "this device's count is saved");
  assert.match(panel, /setRemoteFailed\(Object\.fromEntries\(Object\.entries\(next\?\.failed \?\? \{\}\)\.filter\(\(\[d\]\) => d !== device\)\)\);/);
  const grade = panel.slice(panel.indexOf("if (failedPages.length) {"));
  assert.match(grade, /if \(otherFailed\) \{\s*toast\.error\(/);
  assert.match(grade, /" upload on your other device\. Retry or leave out each one there before grading\."/);
});
