import "server-only";
/**
 * Server-side half of app_events: AI calls that error, time out, or come back
 * unparseable or short, logged where they happen -- in the analyze routes --
 * with the service role (the teacher's browser may be gone by the time a
 * background job fails).
 *
 * Only facts about the call: the mode, the model and effort, what kind of
 * failure, a provider status and token counts. Never the prompt, the pages or
 * the output.
 */
import { BUILD_REF } from "@/lib/build-info";
import { scrubDetail, scrubEventText } from "@/lib/app-events";
import { createServiceClient } from "@/lib/supabase/service";
import { hasSupabaseConfig } from "@/lib/supabase/server";

export type AiFailureKind = "error" | "timeout" | "unparseable" | "short" | "incomplete" | "empty";

export type AiFailure = {
  teacherId: string;
  mode: string;
  kind: AiFailureKind;
  model?: string;
  effort?: string;
  assessmentId?: string | null;
  scanId?: string | null;
  message?: string;
  status?: number;
  /** Extra numbers: groups expected vs returned, output tokens, attempts. */
  counts?: Record<string, number>;
};

/** Classifies a thrown provider error. A 408/504 or an abort is a timeout. */
export function failureKind(error: unknown): AiFailureKind {
  const e = error as { status?: number; name?: string; kind?: string };
  if (e?.status === 408 || e?.status === 504 || e?.name === "TimeoutError" || e?.name === "AbortError")
    return "timeout";
  if (e instanceof SyntaxError) return "unparseable";
  return "error";
}

export async function logAiFailure(f: AiFailure) {
  if (!hasSupabaseConfig()) return;
  try {
    const detail: Record<string, string | number> = { mode: f.mode, kind: f.kind };
    if (f.model) detail.model = f.model.slice(0, 60);
    if (f.effort) detail.effort = f.effort.slice(0, 20);
    if (typeof f.status === "number") detail.status = f.status;
    for (const [k, v] of Object.entries(f.counts ?? {}).slice(0, 6))
      if (Number.isFinite(v)) detail[k.slice(0, 30)] = v;
    const { error } = await createServiceClient().from("app_events").insert({
      teacher_id: f.teacherId,
      build_commit: BUILD_REF || null,
      route: "/api/analyze",
      device_class: "server",
      event_type: "ai_failure",
      message: scrubEventText(f.message ?? `${f.mode}: ${f.kind}`),
      assessment_id: f.assessmentId?.slice(0, 80) ?? null,
      scan_id: f.scanId?.slice(0, 80) ?? null,
      detail: scrubDetail(detail),
    });
    if (error) console.error("ai_failure event not stored", error.code ?? "", error.message);
  } catch (error) {
    // Logging must never turn a reportable failure into a different one.
    console.error("ai_failure event threw", error instanceof Error ? error.name : "unknown");
  }
}
