import { z } from "zod";
import { writingTeacherId, guardOrigin, apiError, HttpError } from "@/lib/teacher-server";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Gives back the one credit of a lesson Generate when one of its three
 * requests failed (review of #199; lib/lesson-billing.ts). The app asks; the
 * database decides: refund_lesson_generation releases the charge only when a
 * request of the same run is recorded as failed, so a lesson that worked can
 * never be refunded from here. At most once per Generate.
 */
const input = z.object({ lessonRun: z.string().uuid() });

export async function POST(request: Request) {
  try {
    guardOrigin(request);
    const user = await writingTeacherId();
    if (!hasSupabaseConfig()) return Response.json({ refunded: false }, { headers: { "Cache-Control": "private, no-store" } });
    const parsed = input.safeParse(await request.json());
    if (!parsed.success) throw new HttpError(400, "Couldn’t read which lesson to refund.");
    const { data, error } = await createServiceClient().rpc("refund_lesson_generation", {
      p_teacher: user,
      p_run: parsed.data.lessonRun,
    });
    // Never claims a refund it did not make: an error (the function not
    // there yet, the database busy) is "not refunded", said plainly.
    if (error) console.error("refund_lesson_generation failed", error.message);
    return Response.json({ refunded: !error && Number(data ?? 0) > 0 }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
