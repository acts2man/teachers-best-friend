import {
  owner,
  apiError,
  HttpError,
  aiConfig,
  readWorkspace,
} from "@/lib/teacher-server";
import { catalogFor } from "@/lib/teacher-catalog";
import type { Workspace } from "@/lib/teacher-types";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { analyzeInput, finalizeAnalysis, responseText } from "@/lib/analyze-shared";
import {
  deleteBackgroundResponse,
  getBackgroundResponse,
  recordScanUsage,
} from "@/lib/analyze-server";

export const maxDuration = 26;

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
    const user = await owner();
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
      await failScan(svc, scanId, config.key, providerId, model, false, "");
      throw new HttpError(500, "The analysis settings couldn’t be read.");
    }
    const p = parsedParams.data;
    const isLesson = p.mode === "lesson";

    const remote = await getBackgroundResponse(providerId, config.key);
    const status = remote.status ?? "in_progress";

    if (status !== "completed") {
      if (!TERMINAL_FAILURES.has(status))
        return Response.json({ status: "analyzing" });
      const userMessage =
        status === "incomplete"
          ? "This document needs a smaller batch. Try fewer pages."
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
      return Response.json({ status: "failed", error: message });
    }

    const saved = await readWorkspace(user);
    if (!saved) throw new HttpError(400, "Open your classroom first.");
    const w = saved.data as Workspace;
    const catalog = catalogFor(w, p.grade, p.framework, p.subject);

    let output: Record<string, unknown>;
    try {
      output = finalizeAnalysis(p, JSON.parse(text), w, catalog);
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
      return Response.json({ status: "failed", error: message });
    }

    // Write the result before recording usage: record_scan_usage flips the row
    // to "complete", and a concurrent poll must not see that status with no
    // result attached.
    const { error: writeError } = await svc
      .from("scans")
      .update({ result: output })
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
    await deleteBackgroundResponse(providerId, config.key);

    return Response.json({ status: "complete", result: output });
  } catch (e) {
    return apiError(e);
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
  await deleteBackgroundResponse(providerId, key);
}
