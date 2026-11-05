import { apiError, HttpError, aiConfig } from "@/lib/teacher-server";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { scansSweepDb, sweepProviderCopies } from "@/lib/provider-retention";

export const maxDuration = 60;

/**
 * The scheduled sweep (review of #203): deletes the AI provider's stored copy
 * of every background job older than an hour whose deletion we have not
 * recorded, so a job the phone never polled back, or one whose delete failed on
 * the poll, does not linger past the ~1 hour the legal pages promise. One pass
 * per call -- the cron runs it hourly (supabase/functions/provider-sweep,
 * triggered by pg_cron), and its working set is small.
 *
 * Triggered server-side only: the OpenAI key lives in this app, so the sweep
 * runs here rather than in the database. A shared CRON_SECRET gates it; nothing
 * about any job's content is read or logged -- counts only.
 */
export async function POST(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!secret || given !== secret) throw new HttpError(401, "Not authorized.");
    if (!hasSupabaseConfig()) throw new HttpError(404, "Not available here.");
    const svc = createServiceClient();
    const key = (await aiConfig()).key;
    const counts = await sweepProviderCopies(scansSweepDb(svc), key);
    // Counts only -- never anything a job contained.
    if (counts.checked > 0) console.info("provider-sweep", JSON.stringify(counts));
    return Response.json({ ok: true, ...counts });
  } catch (e) {
    return apiError(e);
  }
}
