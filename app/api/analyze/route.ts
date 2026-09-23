import { buildStamp } from "@/lib/build-info";
import {
  writingTeacherId,
  readDocument,
  guardOrigin,
  apiError,
  HttpError,
  aiConfig,
  readWorkspace,
} from "@/lib/teacher-server";
import { catalogFor } from "@/lib/teacher-catalog";
import type { Standard, Workspace } from "@/lib/teacher-types";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  analyzeInput,
  buildPrompt,
  finalizeAnalysis,
  responseText,
  type ResponsesResult,
} from "@/lib/analyze-shared";
import { checkSpendGate, enforceSpendGate } from "@/lib/spend-gate";
import {
  chargesForMode,
  confirmPages,
  generationKey,
  releasePages,
} from "@/lib/page-ledger";
import {
  analyzeAsyncEnabled,
  modelSettingsFor,
  recordScanUsage,
  relationalRow,
  runModelSync,
  startModelBackground,
  startScan,
  sharedCatalog,
  shareCatalog,
  isAdminUser,
  aiHttpError,
} from "@/lib/analyze-server";

// Netlify functions default to a 10s timeout and cap at 26s for a synchronous
// invocation. Without this the platform kills a slow analysis mid-flight and
// returns its own HTML gateway page, which the browser then fails to parse as
// JSON. Requesting the ceiling gives real analyses room to finish. The Sites /
// Cloudflare Worker build ignores this Next.js route export.
export const maxDuration = 26;

/**
 * Which build is serving this route.
 *
 * Every scan since build stamping shipped has recorded a null stamp, while
 * /api/version -- read by the deploy check, which has confirmed more than
 * twenty deploys -- reported real commits the whole time. The stamp is written
 * in the same UPDATE as provider_response_id, and provider_response_id is set
 * on every one of those rows, so the statement ran and one column in it came
 * back empty.
 *
 * Both read the same constant now, so if these two endpoints disagree they are
 * being served by different builds, and the fix everyone has been told shipped
 * may not be the code answering their requests. That question was going to sit
 * unanswered until a teacher happened to scan something, which is no way to
 * find out. This makes it a GET: no login, no scan, nothing spent, and the
 * deploy check can ask both on every deploy.
 *
 * Returns only a commit SHA, which is already public in the repository.
 */
export function GET() {
  return Response.json(
    { route: "analyze", commit: buildStamp() },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  try {
    guardOrigin(request);
    const user = await writingTeacherId(),
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
    // A standards lookup another teacher already unlocked is served from the
    // shared library: no scan, no model call, no cost.
    // Admins unlock standards for everyone from the dashboard: those loads
    // are not billed to their own quota and may refresh what is already shared.
    const adminCatalog = Boolean(svc && p.mode === "catalog" && (await isAdminUser(svc!, user)));
    if (svc && p.mode === "catalog" && !(adminCatalog && p.refresh)) {
      const shared = await sharedCatalog(svc, p);
      if (shared.length)
        return Response.json({ result: { standards: shared }, model: "shared-library" });
    }
    // Money ceilings, before anything is charged and before the model is
    // touched. A blocked request spends nothing and leaves nothing to unwind.
    // Admins loading the shared standards library are exempt from their own
    // daily cap -- that work is for every teacher, not them -- but it still
    // counts toward the platform total, because the money was still spent.
    if (svc) {
      const gate = await checkSpendGate(svc, user, adminCatalog);
      await enforceSpendGate(gate, user);
    }

    let scanId: string | null = null;
    if (svc) {
      const [assessmentRow, studentRow] = await Promise.all([
        relationalRow(svc, "assessments", user, p.assessmentId),
        relationalRow(svc, "students", user, p.studentId),
      ]);
      // scans.billable is now only a label on the cost log: "was this a
      // teacher-facing call". What a teacher pays is decided by the page
      // ledger below, per page, not per request. batchIndex used to matter
      // here -- a continuation batch was free so that splitting a class set
      // for our own reasons did not multiply the bill -- and it no longer
      // does: a later batch's pages are already paid for, so it charges
      // nothing without anyone having to remember that it should.
      const billable = !adminCatalog && p.mode !== "name_strip";
      // The charge is performed inside create_scan now, in the same transaction
      // that opens the scan row: a billable, charging-mode request is paid for
      // before its row exists, so no caller -- not a stale copy of the app, not
      // a background replay -- can open a scan that was never charged. A stack
      // that does not fit the teacher's quota raises here, and no scan row is
      // created (nothing to unwind). The scan is stamped with the build that
      // opened it at the same moment.
      scanId = await startScan(
        svc,
        user,
        assessmentRow,
        studentRow,
        p.mode,
        billable,
        p.uploadIds,
        process.env.COMMIT_REF || null,
      );
    }

    // Whether this scan carries a live page charge to settle after the model
    // call. create_scan already reserved it; confirm on success, release on
    // failure.
    const charging = Boolean(svc && scanId && !adminCatalog && chargesForMode(p.mode));
    // A generated lesson or passage had no page, so create_scan charged one
    // against gen:<scanId>. The same key confirms or releases it below.
    const genKey = charging && p.uploadIds.length === 0 ? generationKey(scanId!) : null;
    const settleCharge = async (ok: boolean) => {
      if (!charging) return;
      if (ok) await confirmPages(svc!, user, p.uploadIds, genKey);
      else await releasePages(svc!, user, p.uploadIds, genKey);
    };

    // Background path: start the model job, hand the client a scan id to poll,
    // and return before the platform's function timeout. The poll route reads
    // the result, validates it, and records usage. Only enabled on the
    // Supabase deployment, where the scans table tracks the job.
    if (svc && scanId && analyzeAsyncEnabled()) {
      try {
        const started = await startModelBackground(
          settings,
          content,
          p.mode,
          schema,
          config.key,
        );
        const providerId = started.value;
        const { error } = await svc
          .from("scans")
          .update({
            provider_response_id: providerId,
            provider_model: settings.model,
            params: p,
            status: "analyzing",
            attempts: started.attempts,
            // Which build started this scan. The finishing half runs in a
            // different serverless function and is stamped separately, so a
            // disagreement between the two -- or with origin/main -- shows a
            // stale bundle that reading the source cannot reveal.
            build_ref_start: buildStamp(),
          })
          .eq("id", scanId);
        if (error) {
          console.error("Storing background scan failed", error.message);
          throw new HttpError(500, "Couldn't start the analysis. Please try again.");
        }
      } catch (e) {
        // The job never started, so the pages go back. Confirming them is the
        // poll route's job, once there is a result to confirm.
        await settleCharge(false);
        await recordScanUsage(svc, scanId, {
          ok: false,
          model: settings.model,
          isLesson: p.mode === "lesson",
          usage: undefined,
          errorMessage:
            (e instanceof HttpError && e.detail) ||
            (e instanceof Error ? e.message : String(e)),
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
    let resultData: ResponsesResult | undefined;
    // How many times the provider had to be asked. Recorded on the scan so
    // provider flakiness is a number we can look at rather than a feeling.
    let attempts = 1;
    let ok = false;
    let errorMessage = "";
    try {
      const run = await runModelSync(
        settings,
        content,
        p.mode,
        schema,
        config.key,
        aiTimeoutMs,
      );
      resultData = run.value;
      attempts = run.attempts;
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
      if (svc && p.mode === "catalog")
        await shareCatalog(svc, p, (output.standards ?? []) as Standard[]);
      ok = true;
    } catch (e) {
      // aiHttpError picks the sentence from the failure kind, so an account
      // with no credit left does not read to a teacher as a problem with
      // their upload. It also carries the attempt count out of the wrapper.
      const failure = aiHttpError(e);
      if (typeof (e as { attempts?: number }).attempts === "number")
        attempts = (e as { attempts: number }).attempts;
      errorMessage = failure.detail || failure.message;
      throw e instanceof HttpError ? e : failure;
    } finally {
      await settleCharge(ok);
      if (svc && scanId) {
        await svc.from("scans").update({ attempts }).eq("id", scanId);
        await recordScanUsage(svc, scanId, {
          ok,
          model: settings.model,
          isLesson: p.mode === "lesson",
          usage: resultData?.usage,
          errorMessage,
        });
        // Stamp the build here too. recordScanUsage goes through an RPC that
        // does not touch these columns, so every scan taking this path came
        // back unstamped -- which read as evidence of a stale bundle when it
        // only ever meant the instrument was not wired to this path. Both
        // halves run in this one function when the analysis is synchronous,
        // so both columns get the same value.
        const ref = process.env.COMMIT_REF || null;
        await svc
          .from("scans")
          .update({ build_ref_start: ref, build_ref_finish: ref })
          .eq("id", scanId);
      }
    }
    return Response.json({ result: output, model: settings.model });
  } catch (e) {
    return apiError(e);
  }
}
