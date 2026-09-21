import { z } from "zod";
import {
  writingTeacherId,
  guardOrigin,
  apiError,
  HttpError,
} from "@/lib/teacher-server";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { analyzeInput } from "@/lib/analyze-shared";
import { chargePages, chargesForMode } from "@/lib/page-ledger";

/**
 * Pay for a stack up front, before any of it is sent to the model.
 *
 * A whole-class scan makes a lot of model calls -- one privacy pass per batch
 * of name bands, then grading a few students at a time -- and the teacher
 * should find out that their class set does not fit their remaining quota
 * before any of that starts, not two batches in. So the client reserves the
 * whole stack here first, and every later call finds those pages already paid
 * for and charges nothing.
 *
 * The body upload ids only. Never the name strips: those are the second half
 * of a page the teacher is already paying for, and charging for them would
 * bill every page twice.
 */
const reserveInput = z.object({
  uploadIds: z.array(z.string().uuid()).min(1).max(200),
  mode: analyzeInput.shape.mode,
});

export async function POST(request: Request) {
  try {
    guardOrigin(request);
    const user = await writingTeacherId();
    if (!hasSupabaseConfig())
      throw new HttpError(503, "Plans are not available on this host yet.");
    const input = reserveInput.safeParse(await request.json());
    if (!input.success)
      throw new HttpError(400, "Couldn’t read the pages to reserve.");
    const { uploadIds, mode } = input.data;
    if (!chargesForMode(mode))
      throw new HttpError(
        400,
        "That kind of request doesn’t use a scan, so there is nothing to reserve.",
      );
    // Throws a 402 carrying the teacher-readable count on a stack that does
    // not fit, and writes nothing when it does.
    const charge = await chargePages(createServiceClient(), user, uploadIds, mode);
    return Response.json(charge, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
