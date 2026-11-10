import { withoutNameSeen } from "@/lib/name-seen";
import { incompleteMessage, lessonPartIsFree } from "@/lib/lesson-billing";
import { buildStamp } from "@/lib/build-info";
import {
  owningTeacherId,
  apiError,
  HttpError,
  aiConfig,
  readWorkspace,
} from "@/lib/teacher-server";
import { catalogFor } from "@/lib/teacher-catalog";
import type { Standard, Workspace } from "@/lib/teacher-types";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { analyzeInput, finalizeAnalysis, parseModelOutput, responseText } from "@/lib/analyze-shared";
import {
  chargesForMode,
  confirmPages,
  generationKey,
  releasePages,
} from "@/lib/page-ledger";
import {
  aiHttpError,
  deleteBackgroundResponse,
  getBackgroundResponse,
  recordScanUsage,
  shareCatalog,
} from "@/lib/analyze-server";
import { logAiFailure, type AiFailureKind } from "@/lib/app-events-server";

export const maxDuration = 26;

/**
 * This route never charges. That is the whole reason it cannot double-charge.
 *
 * It replays scan.params, and a poll can be repeated any number of times -- by
 * a phone waking up, by two tabs, by a client retrying. If charging lived here
 * it would have to remember whether it had already run for this scan. Instead
 * the pages were paid for once, in POST /api/analyze, before the job started;
 * all this route does is say whether that work was delivered (confirm, which
 * is idempotent) or not (release, which only ever gives back a reservation
 * that was never confirmed).
 */

// A stored background analysis reports one of these provider statuses. Anything
// other than "completed" that is terminal means the job will not produce usable
// output.
const TERMINAL_FAILURES = new Set(["failed", "cancelled", "canceled", "incomplete"]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ scanId: string }> },
) {
  try {
    if (!hasSupabaseConfig())
      throw new HttpError(404, "This analysis could not be found.");
    const user = await owningTeacherId();
    const { scanId } = await context.params;
    const config = await aiConfig();
    const svc = createServiceClient();

    const { data: scan, error } = await svc
      .from("scans")
      .select(
        "id, status, error, provider_response_id, provider_model, params, result",
      )
      .eq("id", scanId)
      .eq("teacher_id", user)
      .maybeSingle();
    if (error) {
      console.error("Reading scan failed", error.message);
      throw new HttpError(500, "Couldn't check the analysis. Please try again.");
    }
    if (!scan) throw new HttpError(404, "This analysis could not be found.");

    if (scan.status === "complete" && scan.result)
      return Response.json({ status: "complete", result: scan.result });
    if (scan.status === "failed")
      return Response.json({
        status: "failed",
        error:
          scan.error ||
          "The analysis couldn’t be completed. Your documents are saved.",
      });
    if (scan.status !== "analyzing" || !scan.provider_response_id)
      return Response.json({ status: "analyzing" });

    const providerId = scan.provider_response_id as string;
    const model = (scan.provider_model as string) || "";

    // Parse the stored request so the result can be validated and reconciled
    // exactly as the synchronous path would have.
    const parsedParams = analyzeInput.safeParse(scan.params);
    if (!parsedParams.success) {
      // No params means no upload ids, so there is nothing to hand back by
      // name. The reservation ages out on its own after two hours and stops
      // counting against the teacher, which is the same outcome.
      await failScan(svc, scanId, config.key, providerId, model, false, "");
      throw new HttpError(500, "The analysis settings couldn’t be read.");
    }
    const p = parsedParams.data;
    const isLesson = p.mode === "lesson";

    // getBackgroundResponse already retries a transient refusal. Anything that
    // still escapes is converted here so a teacher gets the sentence that
    // matches the failure -- an account out of credit reads as an outage, not
    // as a problem with what they uploaded.
    let remote;
    try {
      remote = await getBackgroundResponse(providerId, config.key);
    } catch (e) {
      // The provider's copy is gone (404) or expired (410): with store:false it
      // is deleted automatically about 10 minutes after the job finishes, so a
      // teacher who comes back much later finds nothing to collect. There is no
      // result and no endless spinner -- fail the scan with a clear message and
      // hand the pages (and their credit) back. The copy is already gone, so
      // record that too.
      const status = (e as { status?: number }).status;
      if (status === 404 || status === 410) {
        const message = "This took too long to collect — please run it again; you weren't charged.";
        await failScan(svc, scanId, config.key, providerId, model, isLesson, message);
        await settle(svc, user, p, scanId, false);
        await svc.from("scans").update({ provider_deleted_at: new Date().toISOString() }).eq("id", scanId);
        await logAiFailure({
          teacherId: user,
          mode: p.mode,
          kind: "timeout",
          model,
          assessmentId: p.assessmentId,
          scanId,
          message: "provider copy expired before collection",
          status,
        });
        return Response.json({ status: "failed", error: message });
      }
      const failure = aiHttpError(e);
      await logAiFailure({
        teacherId: user,
        mode: p.mode,
        kind: failure.status === 504 ? "timeout" : "error",
        model,
        assessmentId: p.assessmentId,
        scanId,
        message: "poll failed: " + failure.message,
        status: failure.status,
      });
      throw failure;
    }
    const status = remote.status ?? "in_progress";

    if (status !== "completed") {
      if (!TERMINAL_FAILURES.has(status))
        return Response.json({ status: "analyzing" });
      const userMessage =
        status === "incomplete"
          ? incompleteMessage(p.mode)
          : "The analysis couldn’t be completed. Your documents are saved.";
      // Persist the provider's own terminal reason (e.g. max_output_tokens,
      // content_filter) to scans.error so a failure can be diagnosed from the
      // table without re-running it.
      const reason = remote.incomplete_details?.reason;
      const storedMessage = `${status}${reason ? ": " + reason : ""} — ${userMessage}`;
      await failScan(
        svc,
        scanId,
        config.key,
        providerId,
        model,
        isLesson,
        storedMessage,
        remote.usage,
      );
      await logAiFailure({
        teacherId: user,
        mode: p.mode,
        kind: (status === "incomplete" ? "incomplete" : "error") as AiFailureKind,
        model,
        assessmentId: p.assessmentId,
        scanId,
        message: storedMessage,
        counts: { outputTokens: remote.usage?.output_tokens ?? 0 },
      });
      await settle(svc, user, p, scanId, false);
      return Response.json({ status: "failed", error: userMessage });
    }

    const text = responseText(remote);
    if (!text) {
      const message =
        "The document couldn’t be analyzed reliably. Please review it manually.";
      await failScan(
        svc,
        scanId,
        config.key,
        providerId,
        model,
        isLesson,
        message,
        remote.usage,
      );
      await logAiFailure({
        teacherId: user,
        mode: p.mode,
        kind: ("empty") as AiFailureKind,
        model,
        assessmentId: p.assessmentId,
        scanId,
        message: message,
        counts: { outputTokens: remote.usage?.output_tokens ?? 0 },
      });
      await settle(svc, user, p, scanId, false);
      return Response.json({ status: "failed", error: message });
    }

    const saved = await readWorkspace(user);
    if (!saved) throw new HttpError(400, "Open your classroom first.");
    const w = saved.data as Workspace;
    const catalog = catalogFor(w, p.grade, p.framework, p.subject);

    let output: Record<string, unknown>;
    try {
      output = finalizeAnalysis(p, parseModelOutput(text), w, catalog);
      if (p.mode === "catalog")
        await shareCatalog(svc, p, (output.standards ?? []) as Standard[]);
    } catch (e) {
      const message =
        e instanceof HttpError ? e.message : "The analysis needs manual review.";
      await failScan(
        svc,
        scanId,
        config.key,
        providerId,
        model,
        isLesson,
        message,
        remote.usage,
      );
      await logAiFailure({
        teacherId: user,
        mode: p.mode,
        kind: ("unparseable") as AiFailureKind,
        model,
        assessmentId: p.assessmentId,
        scanId,
        message: message,
        counts: { outputTokens: remote.usage?.output_tokens ?? 0 },
      });
      await settle(svc, user, p, scanId, false);
      return Response.json({ status: "failed", error: message });
    }

    // Write the result before recording usage: record_scan_usage flips the row
    // to "complete", and a concurrent poll must not see that status with no
    // result attached.
    const { error: writeError } = await svc
      .from("scans")
      // Stamped with the build that actually ran finalizeAnalysis, which is
      // the code every "it should already be fixed" question turns on.
      // Kept without the names read on the piles: those reach only this reply
      // (lib/name-seen.ts withoutNameSeen, review of #203).
      .update({ result: withoutNameSeen(output), build_ref_finish: buildStamp() })
      .eq("id", scanId);
    if (writeError)
      console.error("Storing scan result failed", writeError.message);
    await recordScanUsage(svc, scanId, {
      ok: true,
      model,
      isLesson,
      usage: remote.usage,
      errorMessage: "",
    });
    // An assignment read that found no questions delivered nothing the teacher
    // can use, so it is not charged: hand the pages back rather than confirm
    // them, and mark the scan non-billable so the pages-charged invariant --
    // every billable, complete, charging-mode scan has an attributable charge
    // -- stays true. The result is still returned so the client can keep the
    // upload and say what to check.
    const deliveredNothing =
      p.mode === "assignment" &&
      Array.isArray(output.questions) &&
      (output.questions as unknown[]).length === 0;
    await settle(svc, user, p, scanId, !deliveredNothing);
    if (deliveredNothing)
      await svc.from("scans").update({ billable: false }).eq("id", scanId);
    await recordProviderDeleted(svc, scanId, providerId, config.key);

    return Response.json({ status: "complete", result: output });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * Deletes the provider's copy of this job and records when (provider_deleted_at)
 * so the one-time backfill and its confirm SQL can prove nothing is left. A
 * delete that fails every retry leaves the stamp null; the backfill picks it up.
 * Never throws.
 */
async function recordProviderDeleted(
  svc: ReturnType<typeof createServiceClient>,
  scanId: string,
  providerId: string,
  key: string,
) {
  try {
    const outcome = await deleteBackgroundResponse(providerId, key);
    if (outcome === "failed") return;
    const { error } = await svc.from("scans").update({ provider_deleted_at: new Date().toISOString() }).eq("id", scanId);
    if (error) console.error("Recording provider deletion failed", error.message);
  } catch (error) {
    console.error("Recording provider deletion failed", error instanceof Error ? error.name : "unknown");
  }
}

async function failScan(
  svc: ReturnType<typeof createServiceClient>,
  scanId: string,
  key: string,
  providerId: string,
  model: string,
  isLesson: boolean,
  message: string,
  usage?: Parameters<typeof recordScanUsage>[2]["usage"],
) {
  await recordScanUsage(svc, scanId, {
    ok: false,
    model,
    isLesson,
    usage,
    errorMessage: message,
  });
  await recordProviderDeleted(svc, scanId, providerId, key);
}

/**
 * Confirms or releases the pages this scan reserved.
 *
 * Both calls are safe to repeat: confirm only touches reservations that are
 * not confirmed yet, and release only touches reservations that were never
 * confirmed. A page that graded successfully in an earlier batch is not handed
 * back because a later one failed.
 */
async function settle(
  svc: ReturnType<typeof createServiceClient>,
  teacher: string,
  p: ReturnType<typeof analyzeInput.parse>,
  scanId: string,
  ok: boolean,
) {
  if (!chargesForMode(p.mode) || lessonPartIsFree(p)) return;
  const genKey = p.uploadIds.length === 0 ? generationKey(scanId) : null;
  if (ok) await confirmPages(svc, teacher, p.uploadIds, genKey);
  else await releasePages(svc, teacher, p.uploadIds, genKey);
}
