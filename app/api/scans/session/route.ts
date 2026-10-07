import { z } from "zod";
import {
  apiError,
  guardOrigin,
  HttpError,
  owningTeacherId,
  writingTeacherId,
} from "@/lib/teacher-server";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * A class scan in progress, kept on the teacher's account so the phone and the
 * computer show the same scan (class_scan_sessions; lib/scan-session.ts).
 *
 * GET    ?assessmentId=…  -> { state, revision } or { state: null, revision: 0 }
 * PUT    { assessmentId, state, baseRevision } -> { revision }, or 409 with the
 *        newer { state, revision } when another device saved first
 * DELETE ?assessmentId=…  -> clears it (the class was saved, or started over)
 *
 * Writes are conditional on the revision the device last saw, so two devices
 * cannot silently overwrite each other; the client merges on a 409.
 */

const NO_STORE = { "Cache-Control": "private, no-store" };
/** A class set's session is tens of KB; this only stops something absurd. */
const MAX_STATE_BYTES = 1_000_000;

const putInput = z.object({
  assessmentId: z.string().min(1).max(200),
  state: z.record(z.string(), z.unknown()),
  baseRevision: z.number().int().min(0),
});

function unavailable() {
  // The single-node deployment has no account storage: the client keeps its
  // local draft, exactly as before this existed.
  return Response.json({ error: "Not available on this host." }, { status: 503, headers: NO_STORE });
}

function assessmentParam(request: Request) {
  const id = new URL(request.url).searchParams.get("assessmentId") ?? "";
  if (!id || id.length > 200) throw new HttpError(400, "Choose an assessment first.");
  return id;
}

async function current(teacher: string, assessmentId: string) {
  const { data, error } = await createServiceClient()
    .from("class_scan_sessions")
    .select("state, revision, expires_at")
    .eq("teacher_id", teacher)
    .eq("assessment_id", assessmentId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Couldn’t load the scan in progress.", error.message);
  if (!data) return null;
  // Expired rows are treated as gone; the next write replaces them and the
  // nightly purge deletes any nobody comes back for.
  if (new Date(data.expires_at as string).getTime() < Date.now()) return null;
  return { state: data.state as unknown, revision: data.revision as number };
}

export async function GET(request: Request) {
  try {
    if (!hasSupabaseConfig()) return unavailable();
    // A read, so a "view as" session may see it, like the rest of the workspace.
    const teacher = await owningTeacherId();
    const row = await current(teacher, assessmentParam(request));
    return Response.json(row ?? { state: null, revision: 0 }, { headers: NO_STORE });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    guardOrigin(request);
    if (!hasSupabaseConfig()) return unavailable();
    const teacher = await writingTeacherId();
    const body = await request.text();
    if (body.length > MAX_STATE_BYTES)
      throw new HttpError(413, "This scan is too large to save to your account.");
    const input = putInput.safeParse(JSON.parse(body || "{}"));
    if (!input.success) throw new HttpError(400, "Couldn’t read the scan to save.");
    const { assessmentId, state, baseRevision } = input.data;
    const svc = createServiceClient();
    const existing = await current(teacher, assessmentId);
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    if (!existing) {
      // Nothing live: write fresh (over an expired row, if there is one).
      const { data, error } = await svc
        .from("class_scan_sessions")
        .upsert(
          {
            teacher_id: teacher,
            assessment_id: assessmentId,
            state,
            revision: baseRevision + 1,
            updated_at: new Date().toISOString(),
            expires_at: expires,
          },
          { onConflict: "teacher_id,assessment_id" },
        )
        .select("revision")
        .single();
      if (error) throw new HttpError(500, "Couldn’t save the scan in progress.", error.message);
      return Response.json({ revision: data.revision }, { headers: NO_STORE });
    }

    if (existing.revision !== baseRevision)
      return Response.json(existing, { status: 409, headers: NO_STORE });

    // Conditional on the revision still being the one this device saw: if the
    // other device saved in between, nothing is updated and it is a conflict.
    const { data, error } = await svc
      .from("class_scan_sessions")
      .update({
        state,
        revision: baseRevision + 1,
        updated_at: new Date().toISOString(),
        expires_at: expires,
      })
      .eq("teacher_id", teacher)
      .eq("assessment_id", assessmentId)
      .eq("revision", baseRevision)
      .select("revision");
    if (error) throw new HttpError(500, "Couldn’t save the scan in progress.", error.message);
    if (!data?.length) {
      const now = await current(teacher, assessmentId);
      return Response.json(now ?? { state: null, revision: 0 }, { status: 409, headers: NO_STORE });
    }
    return Response.json({ revision: data[0].revision }, { headers: NO_STORE });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    guardOrigin(request);
    if (!hasSupabaseConfig()) return unavailable();
    const teacher = await writingTeacherId();
    const svc = createServiceClient();
    const { error } = await svc
      .from("class_scan_sessions")
      .delete()
      .eq("teacher_id", teacher)
      .eq("assessment_id", assessmentParam(request));
    if (error) throw new HttpError(500, "Couldn’t clear the scan in progress.", error.message);
    // Tidy this teacher's expired rows while we are here.
    await svc
      .from("class_scan_sessions")
      .delete()
      .eq("teacher_id", teacher)
      .lt("expires_at", new Date().toISOString());
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return apiError(error);
  }
}
