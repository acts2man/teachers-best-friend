// Orphaned student photos in the teacher-documents bucket: files with no
// teacher_uploads row, which the 14-day purge (it works from the rows) will
// therefore never remove. Admin-only; run by hand with the service-role key.
//
// WHY: on 12 Oct 2026 the 05:54 PT backup was restored into the live database
// at 17:36 PT. Photos uploaded in between may still exist as files while their
// rows are gone.
//
// WHAT IT CANNOT SEE (read this before trusting a zero): Supabase lists a
// bucket from the storage.objects table -- the Storage API's list (the
// storage.search functions) and its S3 listing (list_objects_with_delimiter)
// both read it. The restore rolled that table back too, so a file whose
// storage.objects row was lost is invisible to every listing here, and to
// remove() as well. Verified on production 13 Oct: storage.objects holds 518
// teacher-documents rows, none in the lost window, each with an upload row.
// Files that exist only in the underlying store can be listed and removed only
// by Supabase support. What this script does find is every other mismatch: a
// file Storage knows about with no teacher_uploads row (an upload whose row
// insert failed, a row deleted by hand), and a live row whose file is gone.
//
// The lost window, 12 Oct 2026: the request logs DO record those uploads
// (Supabase Logs Explorer, edge_logs: POST /storage/v1/object/teacher-documents/
// <teacher>/<upload> with status 200 -- 47 of them, checked on 13 Oct). Export
// them as "<ISO time><TAB><teacher>/<upload>" lines and pass --logged <file>:
// the report then counts them by teacher and time range too, and confirms none
// has a row. They still cannot be deleted from here -- the paths are what to
// give Supabase support. Logs are kept only a few days on Supabase plans.
//
//   select timestamp, log_attributes['request.path'] from logs
//   where source = 'edge_logs' and log_attributes['request.method'] = 'POST'
//     and log_attributes['request.path'] like '/storage/v1/object/teacher-documents/%'
//     and log_attributes['response.status_code'] = '200'
//   -- with the window set to 2026-10-12T12:54:00Z .. 2026-10-13T00:36:00Z
//
// Three steps, each run separately:
//   1. report   -- counts by teacher and time range; writes a manifest of the
//                  orphans to a local file OUTSIDE the repository. Changes
//                  nothing.
//   2. dry-run  -- reads that manifest, re-checks every path against the
//                  database now, and prints exactly what step 3 would remove,
//                  with the token step 3 needs. Changes nothing.
//   3. delete   -- removes exactly the manifest's still-orphaned paths, through
//                  the Storage API, and only with the dry run's token.
//
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/admin/orphan-photos.mjs report  [--logged lost-window.tsv]
//     node scripts/admin/orphan-photos.mjs dry-run --manifest <path the report printed>
//     node scripts/admin/orphan-photos.mjs delete  --manifest <same> --token <from dry-run>
//
// "A row" means a teacher_uploads row or a legacy uploads row in this bucket:
// both point at files here, and a file either one names is never touched.
// Files younger than an hour are left out (an upload may be mid-flight), and
// the report refuses to write a manifest if more than half the bucket would be
// "orphaned" -- that is a listing or paging fault, not a finding.
//
// The key is read from the environment and never printed or written. The
// manifest holds storage paths (teacher id / upload id), no names or content;
// it is written to the system temp folder with owner-only permissions, and
// never inside the repository.
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { compare, loggedButGone, manifestToken, stillOrphaned, teacherOf, timeRange, isPlaceholder } from "./orphan-photos-lib.mjs";

const BUCKET = "teacher-documents";
const PAGE = Number(process.env.ORPHAN_PAGE_SIZE) || 1000;
const REMOVE_CHUNK = 100;

const [, , step, ...rest] = process.argv;
const arg = (name) => {
  const i = rest.indexOf("--" + name);
  return i >= 0 ? rest[i + 1] : undefined;
};

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
    process.exit(2);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Every file in the bucket, folder by folder, through the Storage API. Pages
 * until an empty one: a server that caps a page below PAGE must not end the
 * listing early (review). */
async function listBucket(svc) {
  const out = [];
  const walk = async (prefix) => {
    for (let offset = 0; ; ) {
      const { data, error } = await svc.storage.from(BUCKET).list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw new Error("listing " + (prefix || "(root)") + ": " + error.message);
      if (!data || !data.length) break;
      for (const item of data) {
        const path = prefix ? prefix + "/" + item.name : item.name;
        // A folder has no id; a file does.
        if (item.id === null || item.id === undefined) await walk(path);
        else if (!isPlaceholder(path)) out.push({ path, size: item.metadata?.size ?? 0, createdAt: item.created_at ?? null });
      }
      offset += data.length;
    }
  };
  await walk("");
  return out;
}

/** Every row that points at a file in this bucket: teacher_uploads, and the
 * legacy uploads table (the purge and account deletion still treat its rows as
 * files here). Pages until an empty page, and checks the total against an
 * exact count, so a capped page can never make a file with a row look like an
 * orphan (review). */
async function rowsFor(svc, table, extra = (q) => q) {
  const { count, error: countError } = await extra(svc.from(table).select("object_path", { count: "exact", head: true }));
  if (countError) {
    if (/does not exist|schema cache/i.test(countError.message)) return [];
    throw new Error(table + ": " + countError.message);
  }
  const rows = [];
  for (let from = 0; ; ) {
    const { data, error } = await extra(svc.from(table).select("object_path, purged_at")).order("object_path").range(from, from + PAGE - 1);
    if (error) throw new Error(table + ": " + error.message);
    if (!data || !data.length) break;
    rows.push(...data);
    from += data.length;
  }
  if (typeof count === "number" && rows.length !== count)
    throw new Error(`${table}: read ${rows.length} rows but the table has ${count}. Stopping rather than calling files orphans.`);
  return rows;
}
async function uploadRows(svc) {
  const [current, legacy] = await Promise.all([
    rowsFor(svc, "teacher_uploads"),
    rowsFor(svc, "uploads", (q) => q.eq("bucket_id", BUCKET)),
  ]);
  return [...current, ...legacy];
}

/** Where the manifest goes: the system temp folder by default, never inside
 * the repository (it holds teacher and upload ids; the repo is public). */
function manifestPath(requested) {
  const path = resolve(requested ?? join(tmpdir(), `orphan-photos-${Date.now()}.json`));
  let repo = "";
  try {
    repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    /* not in a repository */
  }
  if (repo && path.startsWith(resolve(repo) + "/")) {
    console.error(`Refusing to write the manifest inside the repository (${path}). Leave out --out, or give a path outside it.`);
    process.exit(2);
  }
  return path;
}

const mb = (bytes) => (bytes / 1e6).toFixed(1) + " MB";

async function report() {
  const out = manifestPath(arg("out"));
  const svc = client();
  const [objects, rows] = await Promise.all([listBucket(svc), uploadRows(svc)]);
  const { orphans, missing, purgedButPresent, counts } = compare(objects, rows);
  console.log(`Bucket ${BUCKET}: ${objects.length} files listed; ${rows.length} rows point at it (teacher_uploads + legacy uploads).`);
  console.log("NOTE: the listing reads storage.objects. A file whose row the 12 Oct restore removed is not listed -- see --logged in the header of this script.");
  console.log(`\nFiles with no row (never purged): ${orphans.length}`);
  for (const [key, c] of Object.entries(counts).sort()) console.log(`  ${key.padEnd(52)} ${String(c.files).padStart(5)} files  ${mb(c.bytes)}`);
  console.log(`\nLive rows whose file is missing: ${missing.length}`);
  console.log(`Purged rows whose file is still there: ${purgedButPresent.length}${purgedButPresent.length ? " (the purge will not retry these; remove them through Storage after checking)" : ""}`);
  const logged = arg("logged");
  if (logged) {
    const lines = readFileSync(logged, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("uploaded_utc"));
    const entries = lines.map((l) => {
      const [createdAt, raw] = l.split("\t");
      return { createdAt, path: (raw ?? "").replace(/^\/?storage\/v1\/object\/teacher-documents\//, "") };
    });
    const { gone, counts: goneCounts } = loggedButGone(entries, objects, rows);
    console.log(`\nUploads in the request log (${entries.length}) that Storage no longer lists and no table records: ${gone.length}`);
    for (const [key, n] of Object.entries(goneCounts).sort()) console.log(`  ${key.padEnd(52)} ${String(n).padStart(5)} files`);
    if (gone.length) console.log("  These cannot be removed from here (no storage.objects row); give the paths to Supabase support.");
  }
  if (objects.length && orphans.length > objects.length / 2) {
    console.error(`\nRefusing to write a manifest: ${orphans.length} of ${objects.length} files would be orphans. That is a listing or paging fault, not a finding.`);
    process.exit(5);
  }
  const manifest = { bucket: BUCKET, createdAt: new Date().toISOString(), paths: orphans.map((o) => o.path), detail: orphans };
  writeFileSync(out, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(`\nManifest of the ${orphans.length} orphans written to ${out} (outside the repository). Next: dry-run --manifest ${out}`);
}

function readManifest(file) {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  if (manifest.bucket !== BUCKET) {
    console.error(`This manifest is for bucket "${manifest.bucket}", not "${BUCKET}".`);
    process.exit(2);
  }
  return manifest;
}

async function dryRun() {
  const file = arg("manifest");
  if (!file) return usage();
  const manifest = readManifest(file);
  const svc = client();
  const { remove, skipped } = stillOrphaned(manifest.paths, await uploadRows(svc));
  const detail = new Map((manifest.detail ?? []).map((d) => [d.path, d]));
  console.log(`DRY RUN -- nothing is removed. ${remove.length} of ${manifest.paths.length} manifest files would be removed:`);
  for (const p of remove) {
    const d = detail.get(p) ?? {};
    console.log(`  ${p}  ${d.size ?? "?"} bytes  ${d.createdAt ?? "?"}  [${teacherOf(p)}, ${timeRange(d.createdAt)}]`);
  }
  if (skipped.length) console.log(`\n${skipped.length} now have a teacher_uploads row and would be KEPT:\n  ` + skipped.join("\n  "));
  console.log(`\nTo remove exactly these ${remove.length}: delete --manifest ${file} --token ${await manifestToken(remove)}`);
}

async function del() {
  const file = arg("manifest");
  const token = arg("token");
  if (!file || !token) return usage();
  const manifest = readManifest(file);
  const svc = client();
  const { remove } = stillOrphaned(manifest.paths, await uploadRows(svc));
  const expect = await manifestToken(remove);
  if (token !== expect) {
    console.error(`Token ${token} does not match this set (${expect}). The set changed since the dry run, or the token is from another manifest. Run dry-run again and review it.`);
    process.exit(3);
  }
  let removed = 0;
  for (let i = 0; i < remove.length; i += REMOVE_CHUNK) {
    const chunk = remove.slice(i, i + REMOVE_CHUNK);
    const { data, error } = await svc.storage.from(BUCKET).remove(chunk);
    if (error) {
      console.error(`Stopped at ${i} of ${remove.length}: ${error.message}. Run dry-run again; what is left is still listed.`);
      process.exit(4);
    }
    removed += data?.length ?? 0;
  }
  console.log(`Removed ${removed} of ${remove.length} files${removed < remove.length ? `; ${remove.length - removed} were already gone` : ""}.`);
}

function usage() {
  console.error("usage: orphan-photos.mjs report [--out file] [--logged file] | dry-run --manifest file | delete --manifest file --token t");
  process.exit(2);
}

const steps = { report, "dry-run": dryRun, delete: del };
if (!steps[step]) usage();
await steps[step]();
