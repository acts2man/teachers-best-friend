import { z } from "zod";
import {
  writingTeacherId,
  guardOrigin,
  apiError,
  HttpError,
} from "@/lib/teacher-server";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { releasePages } from "@/lib/page-ledger";

/**
 * Hand back a reservation the teacher decided not to use.
 *
 * A stack left reserved stops counting on its own after two hours, so this is
 * not load-bearing -- it is the difference between a teacher who cancels a
 * class set seeing their meter come straight back and wondering for the rest
 * of the afternoon whether they have been charged for work they never got.
 *
 * Only unconfirmed reservations move. Pages that already graded stay charged,
 * so this can never be used to get work back for free.
 */
const releaseInput = z.object({
  uploadIds: z.array(z.string().uuid()).min(1).max(200),
});

export async function POST(request: Request) {
  try {
    guardOrigin(request);
    const user = await writingTeacherId();
    if (!hasSupabaseConfig())
      throw new HttpError(503, "Plans are not available on this host yet.");
    const input = releaseInput.safeParse(await request.json());
    if (!input.success)
      throw new HttpError(400, "Couldn’t read the pages to release.");
    const released = await releasePages(
      createServiceClient(),
      user,
      input.data.uploadIds,
    );
    return Response.json(
      { released },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
