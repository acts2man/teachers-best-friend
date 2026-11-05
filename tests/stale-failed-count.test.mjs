// Review of #194 (2 Nov 2026): a stale failed-page count from another device
// must never block grading for ever. Proven when:
//   - the computer can leave the other device's pages out (with a confirm):
//     that device blocks again only if it reports MORE failed pages, and the
//     leave-out survives a save conflict and that device's next save;
//   - "Start over" clears the other devices' counts and leave-outs;
//   - a save that changes only the counts keeps the scan's expiry, so a
//     count alone never keeps a scan (and its block) alive;
//   - two tabs on one device keep separate counts and never overwrite each
//     other's.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build, buildSync } from "esbuild";

const require = createRequire(import.meta.url);
function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const S = bundle("lib/scan-session.ts");
const panel = readFileSync("components/teacher-class-scan.tsx", "utf8");
const session = (extra = {}) => ({ v: 1, piles: [[{ key: "k", bodyId: "b1" }]], progress: null, groups: null, discarded: [], pageUploadIds: [], grading: null, ...extra });

test("leaving another device's pages out unblocks grading until it reports more", () => {
  const s = { failed: { phone: 2, "laptop/tab": 0 } };
  assert.equal(S.failedElsewhere(s, "laptop/tab"), 2);
  const dismissed = S.dismissFailed(s, "laptop/tab");
  assert.deepEqual(dismissed, { phone: 2 }, "only the other device's count, at what it is now");
  assert.equal(S.failedElsewhere({ ...s, dismissed }, "laptop/tab"), 0, "left out");
  assert.equal(S.failedElsewhere({ failed: { phone: 2 }, dismissed }, "laptop/tab"), 0, "the phone saving the same stale 2 again");
  assert.equal(S.failedElsewhere({ failed: { phone: 3 }, dismissed }, "laptop/tab"), 3, "a new failure there blocks again");
});

test("a leave-out survives a save conflict, and goes when that device has none", () => {
  // The laptop left the phone's 2 out; the phone saved first (it knows nothing of it).
  const server = session({ failed: { phone: 2 } });
  const mine = session({ failed: { phone: 2 }, dismissed: { phone: 2 } });
  const merged = S.mergeSessions(server, mine, "laptop/tab");
  assert.deepEqual(merged.dismissed, { phone: 2 });
  assert.equal(S.failedElsewhere(merged, "laptop/tab"), 0);
  // The phone settled its pages: its count and the leave-out both go.
  const cleared = S.mergeSessions(session({ failed: {} }), mine, "laptop/tab");
  assert.equal(cleared.dismissed, undefined);
  assert.equal(S.parseSession(session({ failed: { phone: 1 }, dismissed: { phone: 1, junk: "x" } })).dismissed.phone, 1);
});

test("Start over clears the other devices' counts and leave-outs; the dialog asks first", () => {
  const reset = panel.slice(panel.indexOf("function reset() {"), panel.indexOf("function reset() {") + 400);
  assert.match(reset, /setRemoteFailed\(\{\}\);\s*setDismissed\(\{\}\);/);
  assert.match(panel, /failed on another device — leave\{" "\}/);
  assert.match(panel, /<AlertDialogAction onClick=\{\(\) => setDismissed\(dismissFailed\(\{ failed: remoteFailed, dismissed \}, failedKey\)\)\}>/);
});

test("a save that changes only the counts is recognised, whatever order jsonb keeps the keys in", () => {
  const before = { v: 1, piles: [[{ key: "k", bodyId: "b1", label: "p" }]], grading: null, failed: { phone: 1 } };
  const reordered = { failed: { phone: 2 }, grading: null, piles: [[{ label: "p", bodyId: "b1", key: "k" }]], v: 1 };
  assert.ok(S.onlyFailedChanged(before, reordered));
  assert.ok(!S.onlyFailedChanged(before, { ...before, piles: [[...before.piles[0], { key: "k2", bodyId: "b2" }]] }));
});

test("the session route keeps the expiry when only the counts changed, and renews it otherwise", async () => {
  const calls = [];
  // Relative to now: a fixed date passed on 5 Nov 2026 and the stub session
  // then read as expired, failing the suite on main for a reason that is not
  // the code's.
  const expires = new Date(Date.now() + 3 * 86400000).toISOString();
  const row = { teacher_id: "t1", assessment_id: "a1", state: { v: 1, piles: [[{ key: "k", bodyId: "b1" }]], failed: { phone: 1 } }, revision: 4, expires_at: expires };
  globalThis.__sessionStub = { calls, row };
  const stub = `
    const s = globalThis.__sessionStub;
    export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
    export const guardOrigin = () => {};
    export const owningTeacherId = async () => "t1";
    export const writingTeacherId = async () => "t1";
    export const apiError = (e) => Response.json({ error: e.message }, { status: e.status ?? 500 });
    export const hasSupabaseConfig = () => true;
    export const createServiceClient = () => ({
      from: () => {
        let patch = null;
        const q = {
          select() { return q; }, eq() { return q; },
          update(p) { patch = p; s.calls.push(p); return q; },
          maybeSingle: async () => ({ data: s.row, error: null }),
          then(res) { return Promise.resolve({ data: patch ? [{ revision: patch.revision }] : [s.row], error: null }).then(res); },
        };
        return q;
      },
    });
  `;
  const r = await build({
    entryPoints: ["app/api/scans/session/route.ts"], bundle: true, platform: "node", format: "cjs", write: false,
    plugins: [{ name: "stub", setup(b) {
      b.onResolve({ filter: /^@\/lib\/(teacher-server|supabase\/server|supabase\/service)$/ }, () => ({ path: "stub", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: stub, loader: "js" }));
    } }],
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  const put = (state) => m.exports.PUT(new Request("https://x/api/scans/session", { method: "PUT", body: JSON.stringify({ assessmentId: "a1", state, baseRevision: 4 }) }));
  assert.equal((await put({ failed: { phone: 1, "laptop/t": 0 }, piles: [[{ bodyId: "b1", key: "k" }]], v: 1 })).status, 200);
  assert.equal(calls[0].expires_at, expires, "only the counts changed: the expiry stays");
  await put({ v: 1, piles: [[{ key: "k", bodyId: "b1" }, { key: "k2", bodyId: "b2" }]], failed: { phone: 1 } });
  assert.ok(Date.parse(calls[1].expires_at) > Date.now() + 6 * 86400000, "a real change renews it (7 days)");
});

test("each tab keeps its own count: two tabs on one device never overwrite each other's", () => {
  const hook = readFileSync("components/use-scan-session.ts", "utf8");
  assert.match(hook, /const key = "tbf\.tab";\s*const found = sessionStorage\.getItem\(key\);/, "kept per tab, across its reloads");
  assert.match(panel, /const \[failedKey\] = useState\(\(\) => device \+ "\/" \+ tabId\(\)\);/);
  // Tab B saves after tab A: A's count stays.
  const server = session({ failed: { "dev/A": 2 } });
  const tabB = session({ failed: { "dev/B": 0, "dev/A": 2 } });
  const merged = S.mergeSessions(server, tabB, "dev/B");
  assert.deepEqual(merged.failed, { "dev/A": 2 });
  assert.equal(S.failedElsewhere(merged, "dev/B"), 2, "tab B waits on tab A's pages");
  assert.equal(S.failedElsewhere(merged, "dev/A"), 0, "and tab A on none but its own");
});
