// Ricky's 72-page class scan stopped twice on 20 Oct: one storage write came
// back 520 (04:02Z and 04:19Z) and the batch ended. Now an upload is retried
// (3 tries, short backoff, 5xx and dropped connections only), looking the file
// up by its content hash before each retry so a retry never makes a second row
// or a second charge; storage itself is retried server-side; and a page that
// still fails waits with a Retry button while the rest of the batch carries on.
// Fake storage only -- nothing here reaches Supabase.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, () => ({}));
  return m.exports;
}
const client = bundle("lib/upload-client.ts");
const { writeWithRetry, isTransientStorageError, STORAGE_TRIES } = bundle("lib/storage-retry.ts");
const { placeRetriedPage } = bundle("lib/scan-session.ts");

/**
 * A fake /api/uploads. `plan` says what each POST does, in order:
 *   "ok"           store the file and answer 200
 *   "fail"         store nothing, answer 520 (the storage hiccup)
 *   "stored-fail"  store the row, then answer 520 (the answer was lost)
 *   "network"      the connection drops (fetch throws)
 *   "too-big"      answer 413
 */
function fakeServer(plan) {
  const rows = new Map(); // sha256 -> record
  const calls = { posts: 0, lookups: 0 };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if ((init.method ?? "GET") === "GET" && u.startsWith("/api/uploads?sha256=")) {
      calls.lookups++;
      const found = rows.get(u.split("=")[1]);
      return found ? Response.json(found) : Response.json({ error: "No matching upload." }, { status: 404 });
    }
    assert.equal(init.method, "POST");
    const step = plan[Math.min(calls.posts, plan.length - 1)];
    calls.posts++;
    const file = init.body.get("file");
    const sha = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
    const store = () => {
      const rec = { id: "upload-" + (rows.size + 1), name: file.name, size: file.size, mime: file.type, pages: 1 };
      rows.set(sha, rec);
      return rec;
    };
    if (step === "network") throw new TypeError("Failed to fetch");
    if (step === "too-big") return Response.json({ error: "Please choose a file smaller than 8 MB." }, { status: 413 });
    if (step === "fail") return new Response("<html>520: Web server returned an unknown error</html>", { status: 520 });
    if (step === "stored-fail") {
      store();
      return Response.json({ error: "Upload failed." }, { status: 520 });
    }
    return Response.json(store());
  };
  return { rows, calls };
}
const page = () => new File([new Uint8Array([255, 216, 255, 1, 2, 3])], "page-7.jpg", { type: "image/jpeg" });
const noWait = () => {
  const waits = [];
  return { waits, sleep: async (ms) => void waits.push(ms) };
};

test("storage fails once, then succeeds: the page uploads on the second try, one row", async () => {
  const s = fakeServer(["fail", "ok"]);
  const { waits, sleep } = noWait();
  const d = await client.uploadFile(page(), { sleep });
  assert.equal(d.id, "upload-1");
  assert.equal(s.calls.posts, 2);
  assert.equal(s.rows.size, 1);
  assert.deepEqual(waits, [600], "a short wait before the retry");
});

test("storage always fails: three tries with backoff, then a clear failure, nothing stored", async () => {
  const s = fakeServer(["fail"]);
  const { waits, sleep } = noWait();
  await assert.rejects(client.uploadFile(page(), { sleep }), /didn't upload after 3 tries/);
  assert.equal(s.calls.posts, client.UPLOAD_TRIES);
  assert.equal(client.UPLOAD_TRIES, 3);
  assert.deepEqual(waits, [600, 1800]);
  assert.equal(s.rows.size, 0);
});

test("the row was stored but the answer was lost: the retry finds it by hash, no second row", async () => {
  const s = fakeServer(["stored-fail", "ok"]);
  const d = await client.uploadFile(page(), noWait());
  assert.equal(d.id, "upload-1");
  assert.equal(s.calls.posts, 1, "never posted again");
  assert.equal(s.rows.size, 1);
});

test("a dropped connection is retried; a 4xx is not", async () => {
  let s = fakeServer(["network", "ok"]);
  assert.equal((await client.uploadFile(page(), noWait())).id, "upload-1");
  assert.equal(s.calls.posts, 2);
  s = fakeServer(["too-big", "ok"]);
  await assert.rejects(client.uploadFile(page(), noWait()), /smaller than 8 MB/);
  assert.equal(s.calls.posts, 1);
});

test("a teacher's own Retry looks the page up first, so an earlier try that stored it is reused", async () => {
  const s = fakeServer(["ok"]);
  await client.uploadFile(page(), noWait());
  const again = await client.uploadFile(page(), { ...noWait(), recoverFirst: true });
  assert.equal(again.id, "upload-1");
  assert.equal(s.calls.posts, 1);
  assert.equal(s.rows.size, 1);
});

// Server side: the storage write inside saveDocument.
function fakeBucket(plan) {
  const objects = new Set();
  let n = 0;
  const write = async () => {
    const step = plan[Math.min(n, plan.length - 1)];
    n++;
    if (step === "network") throw new TypeError("fetch failed");
    if (step === "fail") return { error: { status: 520, statusCode: "520", message: "HTTP 520 error" } };
    if (step === "stored-fail") {
      objects.add("obj");
      return { error: { status: 520, statusCode: "520", message: "HTTP 520 error" } };
    }
    if (step === "bad") return { error: { status: 400, statusCode: "415", message: "invalid mime type" } };
    if (objects.has("obj")) return { error: { status: 400, statusCode: "409", message: "The resource already exists" } };
    objects.add("obj");
    return { error: null };
  };
  return { write, objects, tries: () => n };
}

test("server: storage 520 once, then stored -- one object, two tries", async () => {
  const b = fakeBucket(["fail", "ok"]);
  const waits = [];
  assert.equal(await writeWithRetry(b.write, async (ms) => void waits.push(ms)), 2);
  assert.equal(b.objects.size, 1);
  assert.deepEqual(waits, [300]);
});

test("server: storage always 520 -- three tries, then the error is thrown", async () => {
  const b = fakeBucket(["fail"]);
  await assert.rejects(writeWithRetry(b.write, async () => {}), (e) => e.status === 520);
  assert.equal(b.tries(), STORAGE_TRIES);
  assert.equal(STORAGE_TRIES, 3);
});

test("server: stored but answered 520 -- the retry's 'already exists' is success, not a second object", async () => {
  const b = fakeBucket(["stored-fail", "ok"]);
  assert.equal(await writeWithRetry(b.write, async () => {}), 2);
  assert.equal(b.objects.size, 1);
});

test("server: a dropped connection is retried; a 4xx is not", async () => {
  let b = fakeBucket(["network", "ok"]);
  assert.equal(await writeWithRetry(b.write, async () => {}), 2);
  b = fakeBucket(["bad", "ok"]);
  await assert.rejects(writeWithRetry(b.write, async () => {}));
  assert.equal(b.tries(), 1);
  assert.equal(isTransientStorageError({ status: 520 }), true);
  assert.equal(isTransientStorageError({ message: "fetch failed" }), true);
  assert.equal(isTransientStorageError({ status: 400, statusCode: "409" }), false);
});

test("a retried page goes back into its student's pile, at its place", () => {
  const p = (key) => ({ key, label: key, bodyId: key, stripId: null, pages: 1 });
  const piles = [[p("a1"), p("a3")], [p("b1")]];
  const out = placeRetriedPage(piles, { pile: 0, index: 1 }, p("a2"));
  assert.deepEqual(out.map((pile) => pile.map((x) => x.key)), [["a1", "a2", "a3"], ["b1"]]);
  assert.deepEqual(piles[0].map((x) => x.key), ["a1", "a3"], "not mutated");
  const gone = placeRetriedPage([[p("a1")]], { pile: 4, index: 0, stack: true }, p("z"));
  assert.deepEqual(gone[0].map((x) => [x.key, !!x.stack]), [["z", true], ["a1", false]]);
});

test("the scan keeps going past a failed page, and saveDocument retries storage", () => {
  const scan = readFileSync("components/teacher-class-scan.tsx", "utf8");
  assert.equal((scan.match(/pageFailed\(raw, /g) || []).length, 4, "file picker, photo roll, whole stack, and a camera student uploading in the background");
  assert.match(scan, /if \(failedPages\.length\) \{\s+toast\.error/);
  assert.match(scan, /onClick=\{\(\) => void retryPage\(f\)\}/);
  assert.match(scan, /preparePage\(failed\.file, \{ recoverFirst: true \}\)/);
  const server = readFileSync("lib/teacher-server.ts", "utf8");
  assert.match(server, /await writeWithRetry\(\(\) =>\s+supabase\.storage\s+\.from\(DOCUMENT_BUCKET\)\s+\.upload\(/);
  assert.doesNotMatch(server, /if \(uploadError\) throw uploadError;/);
});
