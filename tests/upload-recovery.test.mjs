// Uploading a file must survive a reply the browser can't read.
//
// A teacher uploaded a JPG and saw "Unexpected token '', "8Ģk{"... is not valid
// JSON": the upload's small JSON reply reached the page as still-compressed
// bytes (a hop between the function and the browser handed it a body it never
// decoded), and the raw r.json() showed the garbage. The upload had actually
// succeeded on the server.
//
// uploadFile is the shared path every upload now goes through. These bundle the
// real module and drive it with a stubbed fetch, proving: a good reply is
// returned as-is; an unreadable reply is recovered by looking the file up by
// its content hash (no second upload); and when nothing can be recovered, a
// clean error is thrown rather than the garbage.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import path from "node:path";

const ROOT = process.cwd();
const built = buildSync({
  entryPoints: ["lib/upload-client.ts"],
  bundle: true, platform: "node", format: "cjs", write: false,
  absWorkingDir: ROOT,
  alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
});
const shim = { exports: {} };
new Function("module", "exports", built.outputFiles[0].text)(shim, shim.exports);
const { uploadFile } = shim.exports;

const RECORD = { id: "u1", name: "1000017007.jpg", size: 1234, mime: "image/jpeg", pages: 1 };
const file = () => new File([new Uint8Array([255, 216, 255, 0, 1, 2, 3, 4])], "1000017007.jpg", { type: "image/jpeg" });

/** Installs a fetch stub and records every call, restoring the real one after. */
function withFetch(handler, run) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), method: opts?.method ?? "GET" });
    return handler({ url: String(url), method: opts?.method ?? "GET" }, calls);
  };
  return Promise.resolve(run(calls)).finally(() => {
    globalThis.fetch = original;
  });
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
// A reply the page can't parse: still-compressed bytes, not JSON.
const garbage = (status = 200) => new Response("\x8b\x1f\x00\x8bĢk{qua", { status });

test("a readable reply is returned unchanged, with no recovery call", async () => {
  await withFetch(
    (req) => (req.method === "POST" ? json(RECORD) : json({ error: "unexpected" }, 500)),
    async (calls) => {
      const result = await uploadFile(file());
      assert.deepEqual(result, RECORD);
      assert.equal(calls.length, 1, "only the upload itself");
      assert.equal(calls[0].method, "POST");
    },
  );
});

test("an unreadable reply is recovered by content hash, without re-uploading", async () => {
  await withFetch(
    (req) => (req.method === "POST" ? garbage() : json(RECORD)),
    async (calls) => {
      const result = await uploadFile(file());
      assert.deepEqual(result, RECORD);
      // Exactly one upload, then one recovery lookup -- never a second POST.
      const posts = calls.filter((c) => c.method === "POST");
      assert.equal(posts.length, 1, "the file is uploaded once, not twice");
      const lookup = calls.find((c) => c.method === "GET");
      assert.ok(lookup, "a recovery lookup was made");
      assert.match(lookup.url, /\/api\/uploads\?sha256=[0-9a-f]{64}$/);
    },
  );
});

test("an unreadable reply with nothing to recover throws a clean error, not garbage", async () => {
  await withFetch(
    (req) => (req.method === "POST" ? garbage() : json({ error: "No matching upload." }, 404)),
    async () => {
      await assert.rejects(uploadFile(file()), (e) => {
        assert.ok(e instanceof Error);
        assert.doesNotMatch(e.message, /Ģk|8Ģk|\x8b/, "no raw bytes surface to the teacher");
        return true;
      });
    },
  );
});

test("a real error reply (readable JSON) is surfaced as its message", async () => {
  await withFetch(
    (req) => (req.method === "POST" ? json({ error: "Please choose a file smaller than 8 MB." }, 413) : json({}, 500)),
    async (calls) => {
      await assert.rejects(uploadFile(file()), /smaller than 8 MB/);
      assert.equal(calls.filter((c) => c.method === "GET").length, 0, "a readable error does not trigger recovery");
    },
  );
});
