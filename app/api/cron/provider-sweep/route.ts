import { timingSafeEqual } from "node:crypto";
import { apiError, HttpError, aiConfig } from "@/lib/teacher-server";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { scansSweepDb, sweepProviderCopies } from "@/lib/provider-retention";

// The host caps a function at 26s; stay under it and let the caller run us
// again (the cron fires every 15 minutes).
export const maxDuration = 26;

/** Constant-time string compare, so the secret cannot be guessed by timing. */
function secretOk(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // timingSafeEqual needs equal lengths; comparing against a fixed-size digest
  // would leak nothing, but a length check first is a plain early-out that does
  // not reveal where a mismatch is.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The scheduled sweep (review of #203): deletes the AI provider's stored copy
 * of each background job the database says is SAFE to delete -- terminal in our
 * row, or older than the job lifetime so it cannot still be running -- whose
 * deletion we have not recorded. It covers a job the client never polled back,
 * and a poll-time delete that failed. One bounded pass per call (the 26s host
 * limit); the cron fires every 15 minutes, so a batch that does not finish is
 * picked up next time.
 *
 * This does not shorten the provider's own abuse-monitoring retention (up to 30
 * days); it removes OUR stored handle as soon as it is safe. The OpenAI key
 * lives in this app, so the sweep runs here, not in the database. A shared
 * CRON_SECRET gates it (constant-time compare); counts only, never content.
 */
export async function POST(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    if (!secret || !secretOk(given, secret)) throw new HttpError(401, "Not authorized.");
    if (!hasSupabaseConfig()) throw new HttpError(404, "Not available here.");
    const svc = createServiceClient();
    const key = (await aiConfig()).key;
    const counts = await sweepProviderCopies(scansSweepDb(svc), key, { budgetMs: 22000 });
    if (counts.checked > 0) console.info("provider-sweep", JSON.stringify(counts));
    return Response.json({ ok: true, ...counts });
  } catch (e) {
    return apiError(e);
  }
}
