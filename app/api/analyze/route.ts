import {
  owner,
  readDocument,
  guardOrigin,
  apiError,
  HttpError,
  aiConfig,
  readWorkspace,
} from "@/lib/teacher-server";
import { catalogFor } from "@/lib/teacher-catalog";
import type { Workspace } from "@/lib/teacher-types";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  analyzeInput,
  buildPrompt,
  finalizeAnalysis,
  responseText,
} from "@/lib/analyze-shared";
import {
  analyzeAsyncEnabled,
  modelSettingsFor,
  recordScanUsage,
  relationalRow,
  runModelSync,
  startModelBackground,
  startScan,
} from "@/lib/analyze-server";

// Netlify functions default to a 10s timeout and cap at 26s for a synchronous
// invocation. Without this the platform kills a slow analysis mid-flight and
// returns its own HTML gateway page, which the browser then fails to parse as
// JSON. Requesting the ceiling gives real analyses room to finish. The Sites /
// Cloudflare Worker build ignores this Next.js route export.
export const maxDuration = 26;

export async function POST(request: Request) {
  try {
    guardOrigin(request);
    const user = await owner(),
      config = await aiConfig();
    if (!config.key)
      throw new HttpError(
        503,
        "AI analysis isn’t connected yet. You can save the document and review questions manually, or explore the sample assessment.",
      );
    const input = analyzeInput.safeParse(await request.json());
    if (!input.success)
      throw new HttpError(400, "Check your analysis settings and try again.");
    const p = input.data;
    const saved = await readWorkspace(user);
    if (!saved) throw new HttpError(400, "Open your classroom first.");
    const w = saved.data as Workspace;
    const catalog = catalogFor(w, p.grade, p.framework, p.subject);
    const content: Record<string, unknown>[] = [];
    let total = 0;
    for (const fid of p.uploadIds) {
      const file = await readDocument(user, fid);
      if (!file)
        throw new HttpError(404, "An uploaded document could not be found.");
      total += file.size;
      if (total > 12 * 1024 * 1024)
        throw new HttpError(413, "Analyze up to 12 MB of documents at a time.");
      const b64 = Buffer.from(file.bytes).toString("base64");
      content.push(
        file.mime === "application/pdf"
          ? {
              type: "input_file",
              filename: file.name,
              file_data: "data:application/pdf;base64," + b64,
            }
          : {
              type: "input_image",
              image_url: "data:" + file.mime + ";base64," + b64,
              detail: "high",
            },
      );
    }
    const { task, schema } = buildPrompt(p, w, catalog, content.length > 0);
    content.push({ type: "input_text", text: task });
    const settings = await modelSettingsFor(p.mode);

    // Metering (Supabase deployment only). The scan is reserved before the
    // model call so quota and account checks gate the spend, and usage is
    // recorded afterwards whether the call succeeds or fails.
    const svc = hasSupabaseConfig() ? createServiceClient() : null;
    let scanId: string | null = null;
    if (svc) {
      const [assessmentRow, studentRow] = await Promise.all([
        relationalRow(svc, "assessments", user, p.assessmentId),
        relationalRow(svc, "students", user, p.studentId),
      ]);
      scanId = await startScan(svc, user, assessmentRow, studentRow);
    }

    // Background path: start the model job, hand the client a scan id to poll,
    // and return before the platform's function timeout. The poll route reads
    // the result, validates it, and records usage. Only enabled on the
    // Supabase deployment, where the scans table tracks the job.
    if (svc && scanId && analyzeAsyncEnabled()) {
      try {
        const providerId = await startModelBackground(
          settings,
          content,
          p.mode,
          schema,
          config.key,
        );
        const { error } = await svc
          .from("scans")
          .update({
            provider_response_id: providerId,
            provider_model: settings.model,
            params: p,
            status: "analyzing",
          })
          .eq("id", scanId);
        if (error) {
          console.error("Storing background scan failed", error.message);
          throw new HttpError(500, "Couldn't start the analysis. Please try again.");
        }
      } catch (e) {
        await recordScanUsage(svc, scanId, {
          ok: false,
          model: settings.model,
          isLesson: p.mode === "lesson",
          usage: undefined,
          errorMessage: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
      return Response.json({ scanId, status: "analyzing" });
    }

    // Synchronous path. On the Supabase/Netlify deployment the surrounding
    // function is capped at 26s, so abort the model call a little sooner and
    // return a graceful JSON error instead of letting the platform terminate
    // the request into an HTML gateway page. The Sites/Cloudflare build has no
    // such cap and keeps the longer budget.
    const aiTimeoutMs = hasSupabaseConfig() ? 24000 : 110000;
    let output: Record<string, unknown>;
    let resultData: Awaited<ReturnType<typeof runModelSync>> | undefined;
    let ok = false;
    let errorMessage = "";
    try {
      resultData = await runModelSync(
        settings,
        content,
        p.mode,
        schema,
        config.key,
        aiTimeoutMs,
      );
      if (resultData.status === "incomplete")
        throw new HttpError(
          422,
          "This document needs a smaller batch. Try fewer pages.",
        );
      const text = responseText(resultData);
      if (!text)
        throw new HttpError(
          422,
          "The document couldn’t be analyzed reliably. Please review it manually.",
        );
      output = finalizeAnalysis(p, JSON.parse(text), w, catalog);
      ok = true;
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
      if (
        e instanceof Error &&
        (e.name === "TimeoutError" || e.name === "AbortError")
      )
        throw new HttpError(
          504,
          "This analysis took too long to finish. Your documents are saved — please try again with fewer pages.",
        );
      throw e;
    } finally {
      if (svc && scanId)
        await recordScanUsage(svc, scanId, {
          ok,
          model: settings.model,
          isLesson: p.mode === "lesson",
          usage: resultData?.usage,
          errorMessage,
        });
    }
    return Response.json({ result: output, model: settings.model });
  } catch (e) {
    return apiError(e);
  }
}
