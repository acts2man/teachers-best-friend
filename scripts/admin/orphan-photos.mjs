// Orphaned student photos in the teacher-documents bucket: files with no
// teacher_uploads row, which the 30-day purge (it works from the rows) will
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
// Three steps, each run separately:
//   1. report   -- counts by teacher and time range; writes a manifest of the
//                  orphans to a local file. Changes nothing.
//   2. dry-run  -- reads that manifest, re-checks every path against the
//                  database now, and prints exactly what step 3 would remove,
//                  with the token step 3 needs. Changes nothing.
//   3. delete   -- removes exactly the manifest's still-orphaned paths, through
//                  the Storage API, and only with the dry run's token.
//
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/admin/orphan-photos.mjs report  --out orphans.json
//     node scripts/admin/orphan-photos.mjs dry-run --manifest orphans.json
//     node scripts/admin/orphan-photos.mjs delete  --manifest orphans.json --token <from dry-run>
//
// The key is read from the environment and never printed or written. The
// manifest holds storage paths (teacher id / upload id), no names or content;
// keep it local -- it is not for the repository.
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { compare, manifestToken, stillOrphaned, teacherOf, timeRange } from "./orphan-photos-lib.mjs";

const BUCKET = "teacher-documents";
const PAGE = 1000;
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

/** Every file in the bucket, folder by folder, through the Storage API. */
async function listBucket(svc) {
  const out = [];
  const walk = async (prefix) => {
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await svc.storage.from(BUCKET).list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw new Error("listing " + (prefix || "(root)") + ": " + error.message);
      for (const item of data ?? []) {
        const path = prefix ? prefix + "/" + item.name : item.name;
        // A folder has no id; a file does.
        if (item.id === null || item.id === undefined) await walk(path);
        else out.push({ path, size: item.metadata?.size ?? 0, createdAt: item.created_at ?? null });
      }
      if (!data || data.length < PAGE) break;
    }
  };
  await walk("");
  return out;
}

/** Every teacher_uploads row's path, a page at a time (one select stops at 1,000). */
async function uploadRows(svc) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await svc.from("teacher_uploads").select("object_path, purged_at").order("object_path").range(from, from + PAGE - 1);
    if (error) throw new Error("teacher_uploads: " + error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

const mb = (bytes) => (bytes / 1e6).toFixed(1) + " MB";

async function report() {
  const out = arg("out") ?? "orphan-photos-manifest.json";
  const svc = client();
  const [objects, rows] = await Promise.all([listBucket(svc), uploadRows(svc)]);
  const { orphans, missing, purgedButPresent, counts } = compare(objects, rows);
  console.log(`Bucket ${BUCKET}: ${objects.length} files listed; teacher_uploads: ${rows.length} rows.`);
  console.log("NOTE: the listing reads storage.objects. A file whose row the 12 Oct restore removed is not listed (see the header of this script).");
  console.log(`\nFiles with no teacher_uploads row (never purged): ${orphans.length}`);
  for (const [key, c] of Object.entries(counts).sort()) console.log(`  ${key.padEnd(52)} ${String(c.files).padStart(5)} files  ${mb(c.bytes)}`);
  console.log(`\nLive rows whose file is missing: ${missing.length}`);
  console.log(`Purged rows whose file is still there: ${purgedButPresent.length}`);
  const manifest = { bucket: BUCKET, createdAt: new Date().toISOString(), paths: orphans.map((o) => o.path), detail: orphans };
  writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest of the ${orphans.length} orphans written to ${out} (local only). Next: dry-run --manifest ${out}`);
}

async function dryRun() {
  const file = arg("manifest");
  if (!file) return usage();
  const manifest = JSON.parse(readFileSync(file, "utf8"));
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
  const manifest = JSON.parse(readFileSync(file, "utf8"));
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
  console.log(`Removed ${removed} of ${remove.length} files.`);
}

function usage() {
  console.error("usage: orphan-photos.mjs report [--out file] | dry-run --manifest file | delete --manifest file --token t");
  process.exit(2);
}

const steps = { report, "dry-run": dryRun, delete: del };
if (!steps[step]) usage();
await steps[step]();
