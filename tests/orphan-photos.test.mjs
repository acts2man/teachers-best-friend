// scripts/admin/orphan-photos.mjs: the report, the dry run and the delete for
// files in teacher-documents with no teacher_uploads row. Paths are synthetic.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compare, timeRange, stillOrphaned, manifestToken } from "../scripts/admin/orphan-photos-lib.mjs";

const T1 = "aaaaaaaa-1111-1111-1111-111111111111";
const T2 = "bbbbbbbb-2222-2222-2222-222222222222";

test("orphans, missing files and purged-but-present are told apart, counted by teacher and time range", () => {
  const objects = [
    { path: `${T1}/u1.jpg`, size: 100, createdAt: "2026-10-12T03:00:00Z" },
    { path: `${T1}/u2.jpg`, size: 200, createdAt: "2026-10-12T15:00:00Z" }, // lost window, no row
    { path: `${T2}/u3.jpg`, size: 300, createdAt: "2026-10-13T02:00:00Z" }, // after, no row
    { path: `${T2}/u4.jpg`, size: 400, createdAt: "2026-09-01T00:00:00Z" }, // purged row, file still here
  ];
  const rows = [
    { object_path: `${T1}/u1.jpg`, purged_at: null },
    { object_path: `${T2}/u4.jpg`, purged_at: "2026-10-01T09:00:00Z" },
    { object_path: `${T2}/gone.jpg`, purged_at: null },
  ];
  const r = compare(objects, rows);
  assert.deepEqual(r.orphans.map((o) => o.path), [`${T1}/u2.jpg`, `${T2}/u3.jpg`]);
  assert.deepEqual(r.missing, [`${T2}/gone.jpg`]);
  assert.deepEqual(r.purgedButPresent, [`${T2}/u4.jpg`]);
  assert.deepEqual(r.counts, {
    "aaaaaaaa | lost window (12 Oct 05:54-17:36 PT)": { files: 1, bytes: 200 },
    "bbbbbbbb | after the restore": { files: 1, bytes: 300 },
  });
  assert.equal(timeRange("2026-10-12T12:53:59Z"), "before the backup point");
  assert.equal(timeRange(null), "unknown");
});

test("the delete set is re-checked: a path that has a row by now is kept", async () => {
  const { remove, skipped } = stillOrphaned(["a/1", "a/2"], [{ object_path: "a/2" }]);
  assert.deepEqual([remove, skipped], [["a/1"], ["a/2"]]);
  assert.equal(await manifestToken(["b", "a"]), await manifestToken(["a", "b"]), "order does not matter");
  assert.notEqual(await manifestToken(["a"]), await manifestToken(["a", "b"]));
});

// ---- The CLI end to end, against a stand-in for Storage and PostgREST -------
function fakeSupabase(state) {
  return http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const send = (code, json) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      };
      const url = new URL(req.url, "http://x");
      if (req.method === "POST" && url.pathname === "/storage/v1/object/list/teacher-documents") {
        const { prefix = "", limit = 100, offset = 0 } = JSON.parse(body || "{}");
        const under = state.files.filter((f) => (prefix ? f.path.startsWith(prefix + "/") : true));
        const names = new Map();
        for (const f of under) {
          const rest = prefix ? f.path.slice(prefix.length + 1) : f.path;
          const [head, ...more] = rest.split("/");
          names.set(head, more.length ? { name: head, id: null } : { name: head, id: "id-" + f.path, created_at: f.createdAt, metadata: { size: f.size } });
        }
        return send(200, [...names.values()].slice(offset, offset + limit));
      }
      if (req.method === "DELETE" && url.pathname === "/storage/v1/object/teacher-documents") {
        const { prefixes } = JSON.parse(body);
        state.deleted.push(...prefixes);
        state.files = state.files.filter((f) => !prefixes.includes(f.path));
        return send(200, prefixes.map((name) => ({ name })));
      }
      if (req.method === "GET" && url.pathname === "/rest/v1/teacher_uploads") {
        const [from, to] = (req.headers.range ?? "0-999").split("-").map(Number);
        return send(200, state.rows.slice(from, to + 1));
      }
      send(404, { message: "not found " + req.method + " " + url.pathname });
    });
  });
}

function cli(port, ...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, ["scripts/admin/orphan-photos.mjs", ...args], {
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: "test-key-not-real" },
    }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, out: stdout + stderr }));
  });
}

test("report and dry run change nothing; delete removes exactly the reviewed set, only with its token", async () => {
  const state = {
    files: [
      { path: `${T1}/keep.jpg`, size: 10, createdAt: "2026-10-11T00:00:00Z" },
      { path: `${T1}/orphan.jpg`, size: 20, createdAt: "2026-10-12T15:00:00Z" },
      { path: `${T2}/orphan2.jpg`, size: 30, createdAt: "2026-10-13T01:00:00Z" },
    ],
    rows: [{ object_path: `${T1}/keep.jpg`, purged_at: null }],
    deleted: [],
  };
  const server = fakeSupabase(state);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const dir = mkdtempSync(join(tmpdir(), "orphans-"));
  const manifest = join(dir, "m.json");
  try {
    const rep = await cli(port, "report", "--out", manifest);
    assert.equal(rep.code, 0, rep.out);
    assert.match(rep.out, /no teacher_uploads row \(never purged\): 2/);
    assert.doesNotMatch(rep.out, /test-key-not-real/, "the key is never printed");
    assert.deepEqual(JSON.parse(readFileSync(manifest, "utf8")).paths, [`${T1}/orphan.jpg`, `${T2}/orphan2.jpg`]);

    // An upload's row appears between the report and the dry run: it is kept.
    state.rows.push({ object_path: `${T2}/orphan2.jpg`, purged_at: null });
    const dry = await cli(port, "dry-run", "--manifest", manifest);
    assert.equal(dry.code, 0, dry.out);
    assert.match(dry.out, /1 of 2 manifest files would be removed/);
    assert.match(dry.out, /would be KEPT/);
    const token = /--token ([0-9a-f]{12})/.exec(dry.out)[1];
    assert.deepEqual(state.deleted, [], "report and dry run removed nothing");

    const wrong = await cli(port, "delete", "--manifest", manifest, "--token", "000000000000");
    assert.equal(wrong.code, 3);
    assert.deepEqual(state.deleted, [], "a wrong token removes nothing");

    const del = await cli(port, "delete", "--manifest", manifest, "--token", token);
    assert.equal(del.code, 0, del.out);
    assert.deepEqual(state.deleted, [`${T1}/orphan.jpg`], "exactly the reviewed, still-orphaned file");
    assert.deepEqual(state.files.map((f) => f.path).sort(), [`${T1}/keep.jpg`, `${T2}/orphan2.jpg`]);
  } finally {
    server.close();
  }
});
