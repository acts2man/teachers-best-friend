// scripts/admin/orphan-photos.mjs: the report, the dry run and the delete for
// files in teacher-documents with no teacher_uploads row. Paths are synthetic.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compare, timeRange, stillOrphaned, manifestToken, loggedButGone } from "../scripts/admin/orphan-photos-lib.mjs";

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
  const r = compare(objects, rows, undefined, { now: Date.parse("2026-10-14T00:00:00Z") });
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

test("a file under an hour old, or the dashboard's folder marker, is never an orphan", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  const r = compare([
    { path: `${T1}/fresh.jpg`, createdAt: "2026-10-13T11:30:00Z" },
    { path: `${T1}/.emptyFolderPlaceholder`, createdAt: "2026-10-01T00:00:00Z" },
    { path: `${T1}/old.jpg`, createdAt: "2026-10-13T10:00:00Z" },
  ], [], undefined, { now });
  assert.deepEqual(r.orphans.map((o) => o.path), [`${T1}/old.jpg`]);
});

test("uploads the request log saw that nothing lists or records are counted by teacher and window", () => {
  const { gone, counts } = loggedButGone(
    [{ path: `${T1}/a`, createdAt: "2026-10-12T18:00:00Z" }, { path: `${T1}/b`, createdAt: "2026-10-12T18:01:00Z" }, { path: `${T2}/c`, createdAt: "2026-10-12T17:52:00Z" }, { path: `${T2}/listed`, createdAt: "2026-10-12T17:53:00Z" }],
    [{ path: `${T2}/listed` }],
    [],
  );
  assert.equal(gone.length, 3);
  assert.deepEqual(counts, { "aaaaaaaa | lost window (12 Oct 05:54-17:36 PT)": 2, "bbbbbbbb | lost window (12 Oct 05:54-17:36 PT)": 1 });
});

// ---- The CLI end to end, against a stand-in for Storage and PostgREST -------
// It behaves like the real services where it matters: supabase-js sends
// offset/limit query parameters (and HEAD + Prefer: count=exact for a count),
// and a server may cap a page below what was asked (`cap`).
function fakeSupabase(state) {
  return http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const send = (code, json, headers = {}) => {
        res.writeHead(code, { "content-type": "application/json", ...headers });
        res.end(req.method === "HEAD" ? undefined : JSON.stringify(json));
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
        const sorted = [...names.values()].sort((a, b) => a.name.localeCompare(b.name));
        return send(200, sorted.slice(offset, offset + Math.min(limit, state.cap ?? limit)));
      }
      if (req.method === "DELETE" && url.pathname === "/storage/v1/object/teacher-documents") {
        const { prefixes } = JSON.parse(body);
        const hit = prefixes.filter((p) => state.files.some((f) => f.path === p));
        state.deleted.push(...hit);
        state.files = state.files.filter((f) => !prefixes.includes(f.path));
        return send(200, hit.map((name) => ({ name })));
      }
      const table = url.pathname.match(/^\/rest\/v1\/(teacher_uploads|uploads)$/)?.[1];
      if (table) {
        let rows = state[table] ?? [];
        const bucket = url.searchParams.get("bucket_id");
        if (bucket) rows = rows.filter((r) => "eq." + r.bucket_id === bucket);
        rows = [...rows].sort((a, b) => a.object_path.localeCompare(b.object_path));
        if (req.method === "HEAD") return send(200, null, { "content-range": `*/${rows.length}` });
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 1000);
        return send(200, rows.slice(offset, offset + Math.min(limit, state.cap ?? limit)).map(({ object_path, purged_at }) => ({ object_path, purged_at })));
      }
      send(404, { message: "not found " + req.method + " " + url.pathname });
    });
  });
}

function cli(port, args, env = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, ["scripts/admin/orphan-photos.mjs", ...args], {
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: "test-key-not-real", ...env },
    }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, out: stdout + stderr }));
  });
}

async function withServer(state, fn) {
  const server = fakeSupabase(state);
  await new Promise((r) => server.listen(0, r));
  try {
    return await fn(server.address().port);
  } finally {
    server.close();
  }
}

const OLD = "2026-10-11T00:00:00Z";

test("report and dry run change nothing; delete removes exactly the reviewed set, only with its token", async () => {
  const state = {
    files: [
      { path: `${T1}/keep.jpg`, size: 10, createdAt: OLD },
      { path: `${T1}/orphan.jpg`, size: 20, createdAt: "2026-10-12T15:00:00Z" },
      { path: `${T2}/orphan2.jpg`, size: 30, createdAt: "2026-10-13T01:00:00Z" },
      { path: `${T2}/a1/deep.jpg`, size: 40, createdAt: OLD }, // two levels down, legacy row
      { path: `${T2}/.emptyFolderPlaceholder`, size: 0, createdAt: OLD },
    ],
    teacher_uploads: [{ object_path: `${T1}/keep.jpg`, purged_at: null }],
    uploads: [{ object_path: `${T2}/a1/deep.jpg`, purged_at: null, bucket_id: "teacher-documents" }],
    deleted: [],
  };
  const dir = mkdtempSync(join(tmpdir(), "orphans-"));
  const manifest = join(dir, "m.json");
  await withServer(state, async (port) => {
    const rep = await cli(port, ["report", "--out", manifest]);
    assert.equal(rep.code, 0, rep.out);
    assert.match(rep.out, /Files with no row \(never purged\): 2/);
    assert.doesNotMatch(rep.out, /test-key-not-real/, "the key is never printed");
    assert.deepEqual(JSON.parse(readFileSync(manifest, "utf8")).paths, [`${T1}/orphan.jpg`, `${T2}/orphan2.jpg`], "a file a legacy row names is not an orphan");
    assert.equal(statSync(manifest).mode & 0o777, 0o600, "owner-only");

    // An upload's row appears between the report and the dry run: it is kept.
    state.teacher_uploads.push({ object_path: `${T2}/orphan2.jpg`, purged_at: null });
    const dry = await cli(port, ["dry-run", "--manifest", manifest]);
    assert.equal(dry.code, 0, dry.out);
    assert.match(dry.out, /1 of 2 manifest files would be removed/);
    assert.match(dry.out, /would be KEPT/);
    const token = /--token ([0-9a-f]{12})/.exec(dry.out)[1];
    assert.deepEqual(state.deleted, [], "report and dry run removed nothing");

    const wrong = await cli(port, ["delete", "--manifest", manifest, "--token", "000000000000"]);
    assert.equal(wrong.code, 3);
    assert.deepEqual(state.deleted, [], "a wrong token removes nothing");

    const del = await cli(port, ["delete", "--manifest", manifest, "--token", token]);
    assert.equal(del.code, 0, del.out);
    assert.deepEqual(state.deleted, [`${T1}/orphan.jpg`], "exactly the reviewed, still-orphaned file");
  });
});

test("paging: more rows and files than a page, and a server that caps pages short, still reads everything", async () => {
  const files = [];
  const rows = [];
  for (let i = 0; i < 23; i++) {
    const path = `${T1}/f${String(i).padStart(2, "0")}.jpg`;
    files.push({ path, size: 1, createdAt: OLD });
    if (i !== 7) rows.push({ object_path: path, purged_at: null });
  }
  const dir = mkdtempSync(join(tmpdir(), "orphans-"));
  for (const cap of [undefined, 2]) {
    const state = { files: files.map((f) => ({ ...f })), teacher_uploads: rows, uploads: [], deleted: [], cap };
    const manifest = join(dir, `p${cap ?? "full"}.json`);
    await withServer(state, async (port) => {
      const rep = await cli(port, ["report", "--out", manifest], { ORPHAN_PAGE_SIZE: "5" });
      assert.equal(rep.code, 0, rep.out);
      assert.match(rep.out, /23 files listed; 22 rows/, `cap ${cap}`);
      assert.deepEqual(JSON.parse(readFileSync(manifest, "utf8")).paths, [`${T1}/f07.jpg`], `cap ${cap}: only the one real orphan`);
    });
  }
});

test("safety: no manifest inside the repository, none when most of the bucket looks orphaned, and the logged uploads are reported", async () => {
  const state = { files: [{ path: `${T1}/x.jpg`, size: 1, createdAt: OLD }], teacher_uploads: [], uploads: [], deleted: [] };
  await withServer(state, async (port) => {
    const inside = await cli(port, ["report", "--out", "orphans.json"]);
    assert.equal(inside.code, 2);
    assert.match(inside.out, /Refusing to write the manifest inside the repository/);
    const dir = mkdtempSync(join(tmpdir(), "orphans-"));
    const log = join(dir, "lost.tsv");
    writeFileSync(log, `uploaded_utc\tbucket_path\n2026-10-12T18:24:28.054Z\t${T1}/lost-1\n2026-10-12T17:52:29.985Z\t/storage/v1/object/teacher-documents/${T2}/lost-2\n`);
    const most = await cli(port, ["report", "--out", join(dir, "m.json"), "--logged", log]);
    assert.equal(most.code, 5, most.out);
    assert.match(most.out, /Refusing to write a manifest: 1 of 1/);
    assert.match(most.out, /request log \(2\) that Storage no longer lists and no table records: 2/);
    assert.match(most.out, /aaaaaaaa \| lost window/);
  });
});
