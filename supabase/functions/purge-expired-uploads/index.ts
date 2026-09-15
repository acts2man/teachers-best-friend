import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Deletes uploaded student work whose retention window has passed.
//
// This has to run here rather than in SQL: Postgres blocks direct DELETE
// against storage.objects, and the documented escape hatch only removes the
// database row while leaving the file itself orphaned in the bucket. A
// privacy commitment to delete student work needs the file actually gone, so
// this goes through the Storage API.
//
// Two tables are covered. teacher_uploads is what the app writes to today;
// uploads is the older table kept for the rows already in it.
//
// Scheduled by pg_cron (job "purge-expired-uploads", daily at 09:00 UTC),
// which calls this over pg_net. See supabase/migrations/README.md.

const BATCH = 200;

type Row = { id: string; object_path: string; bucket_id?: string | null };

Deno.serve(async () => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing service credentials" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  const db = createClient(url, key);
  const report: Record<string, unknown> = {};

  for (const table of ["teacher_uploads", "uploads"] as const) {
    const { data, error } = await db
      .from(table)
      .select(table === "uploads" ? "id, object_path, bucket_id" : "id, object_path")
      .is("purged_at", null)
      .lte("expires_at", new Date().toISOString())
      .limit(BATCH);

    if (error) {
      report[table] = { error: error.message };
      continue;
    }
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) {
      report[table] = { due: 0, deleted: 0 };
      continue;
    }

    // Group by bucket so one call per bucket removes its objects.
    const byBucket = new Map<string, Row[]>();
    for (const row of rows) {
      const bucket = row.bucket_id ?? "teacher-documents";
      byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), row]);
    }

    const purgedIds: string[] = [];
    const failures: string[] = [];
    for (const [bucket, bucketRows] of byBucket) {
      const paths = bucketRows.map((r) => r.object_path).filter(Boolean);
      const { error: rmError } = await db.storage.from(bucket).remove(paths);
      if (rmError) {
        // Leave purged_at unset so the next run retries rather than
        // reporting work as deleted when the file is still there.
        failures.push(`${bucket}: ${rmError.message}`);
        continue;
      }
      purgedIds.push(...bucketRows.map((r) => r.id));
    }

    if (purgedIds.length > 0) {
      const { error: markError } = await db
        .from(table)
        .update({ purged_at: new Date().toISOString() })
        .in("id", purgedIds);
      if (markError) failures.push(`mark: ${markError.message}`);
    }

    report[table] = {
      due: rows.length,
      deleted: purgedIds.length,
      ...(failures.length ? { failures } : {}),
    };
  }

  return new Response(JSON.stringify({ ok: true, ...report }), {
    headers: { "Content-Type": "application/json" },
  });
});
