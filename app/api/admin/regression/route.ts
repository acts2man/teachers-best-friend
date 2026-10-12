/**
 * The regression replay's server half. One action per request; the replay page
 * (app/regression) drives the sequence so no request outlives the function
 * limit. Everyone not on regression_admins gets a 404 before anything is read
 * (lib/regression/gate.ts).
 *
 * Responses carry anonymised case codes and numbers only -- never a name, an
 * answer, or an assessment title.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { BUILD_REF } from "@/lib/build-info";
import { aiConfig, apiError, guardOrigin, HttpError, normalizeWorkspace } from "@/lib/teacher-server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireRegressionAdminApi } from "@/lib/regression/gate";
import { planCase, stepCase, type RunState } from "@/lib/regression/runner";
import { copyFixtures, createCases, revokeFixtures } from "@/lib/regression/fixtures";
import { CaseRefused } from "@/lib/regression/expected";
import { checkWorkspace } from "@/lib/regression/old-data";
import { CASE_KINDS, type RegressionCase } from "@/lib/regression/types";
import { scrubEventText } from "@/lib/app-events";
import type { Workspace } from "@/lib/teacher-types";

// Each action is bounded well inside this: a start is capped at 20s and a poll
// at 18s by lib/analyze-server.ts; everything else is a few queries.
export const maxDuration = 26;
export const dynamic = "force-dynamic";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("summary") }),
  z.object({ action: z.literal("start-run") }),
  z.object({ action: z.literal("step"), runId: z.string().uuid(), caseCode: z.string().regex(/^case-[a-z0-9]{4,12}$/) }),
  z.object({ action: z.literal("finish-run"), runId: z.string().uuid() }),
  z.object({ action: z.literal("abandon-run"), runId: z.string().uuid() }),
  z.object({ action: z.literal("copy-fixtures"), assessmentId: z.string().min(1).max(80) }),
  z.object({ action: z.literal("create-cases"), assessmentId: z.string().min(1).max(80), kinds: z.array(z.enum(CASE_KINDS)).min(1) }),
  z.object({ action: z.literal("revoke"), assessmentId: z.string().min(1).max(80) }),
  z.object({ action: z.literal("old-data-check"), index: z.number().int().min(0) }),
]);

/** A finished grading pass of the same assessment in this run, ready to be
 * scored by another case, or null. */
async function siblingGrading(svc: ReturnType<typeof createServiceClient>, runId: string, c: RegressionCase): Promise<RunState | null> {
  const { data } = await svc
    .from("regression_run_cases")
    .select("state, regression_cases!inner(assessment_legacy_id, teacher_id, kind)")
    .eq("run_id", runId)
    .in("status", ["passed", "failed"])
    .eq("regression_cases.assessment_legacy_id", c.assessmentLegacyId)
    .eq("regression_cases.teacher_id", c.teacherId)
    .in("regression_cases.kind", ["answer_reading", "grouping"]);
  const done = (data ?? []).map((r) => r.state as RunState).find((st) => st?.stage === "grade" && st.cursor >= st.batches.length);
  return done ? { ...done, job: null } : null;
}

const anon = (salt: string) => (id: string) =>
  "a-" + createHash("sha256").update(salt + "|" + id).digest("hex").slice(0, 10);

export async function POST(request: Request) {
  try {
    guardOrigin(request);
    const admin = await requireRegressionAdminApi();
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "That request isn't one the replay understands.");
    const b = parsed.data;
    const svc = createServiceClient();

    if (b.action === "summary") {
      const [{ data: cases }, { data: runs }] = await Promise.all([
        svc.from("regression_cases").select("code, kind, active, created_at").order("created_at"),
        svc
          .from("regression_runs")
          .select("id, started_at, finished_at, build_commit, status, summary")
          .order("started_at", { ascending: false })
          .limit(10),
      ]);
      return Response.json({ cases: cases ?? [], runs: runs ?? [] });
    }

    if (b.action === "start-run") {
      const [{ data: config, error: configError }, { data: cases, error: casesError }] = await Promise.all([
        svc.from("pipeline_config").select("stage, model, reasoning_effort, max_output_tokens").order("stage"),
        svc.from("regression_cases").select("id, code").eq("active", true).order("created_at"),
      ]);
      if (configError || casesError) throw new HttpError(500, "Couldn't read the cases or the AI settings.");
      if (!cases?.length) throw new HttpError(400, "There are no test cases yet.");
      const { data: run, error } = await svc
        .from("regression_runs")
        .insert({ started_by: admin, build_commit: BUILD_REF || null, pipeline_config: config ?? [] })
        .select("id")
        .single();
      if (error || !run) throw new HttpError(500, "Couldn't start the run.");
      const { error: rowsError } = await svc
        .from("regression_run_cases")
        .insert(cases.map((c) => ({ run_id: run.id, case_id: c.id })));
      if (rowsError) throw new HttpError(500, "Couldn't start the run.");
      return Response.json({ runId: run.id, cases: cases.map((c) => c.code) });
    }

    if (b.action === "step") {
      const { data: c } = await svc
        .from("regression_cases")
        .select("id, code, teacher_id, assessment_legacy_id, kind, expected")
        .eq("code", b.caseCode)
        .maybeSingle();
      if (!c) throw new HttpError(404, "No such case.");
      const { data: row } = await svc
        .from("regression_run_cases")
        .select("status, state, cost_usd, model, effort")
        .eq("run_id", b.runId)
        .eq("case_id", c.id)
        .maybeSingle();
      if (!row) throw new HttpError(404, "That case is not part of this run.");
      if (row.status !== "pending" && row.status !== "running")
        return Response.json({ status: row.status, progress: "Done" });
      const rc: RegressionCase = {
        id: c.id,
        code: c.code,
        teacherId: c.teacher_id,
        assessmentLegacyId: c.assessment_legacy_id,
        kind: c.kind,
        expected: c.expected,
      };
      const usage = { costUsd: Number(row.cost_usd) || 0, model: row.model ?? "", effort: row.effort ?? "" };
      let state = row.state as RunState | Record<string, never>;
      let result: { status: string; progress: string; metrics?: Record<string, unknown> };
      try {
        if (!("stage" in state)) {
          state = await planCase(svc, rc);
          // answer_reading and grouping on the same assessment grade the same
          // pages the same way; when the other has already graded in this run,
          // score its answers instead of paying for a second grading pass.
          if (state.stage === "grade") {
            const shared = await siblingGrading(svc, b.runId, rc);
            if (shared) state = shared;
          }
          result = { status: "running", progress: "Planned" };
        } else {
          const out = await stepCase(svc, rc, (await aiConfig()).key, state as RunState, usage);
          state = out.state;
          result = out.result;
        }
      } catch (e) {
        // Scrubbed: a JSON.parse error quotes the model's output, which can be
        // a student's answer or name.
        const message = scrubEventText((e instanceof Error ? e.name + ": " + e.message : String(e)), 400);
        await svc
          .from("regression_run_cases")
          .update({ status: "error", error: message, state, cost_usd: usage.costUsd, model: usage.model, effort: usage.effort, updated_at: new Date().toISOString() })
          .eq("run_id", b.runId)
          .eq("case_id", c.id);
        return Response.json({ status: "error", progress: message });
      }
      await svc
        .from("regression_run_cases")
        .update({
          status: result.status,
          state,
          metrics: result.metrics ?? null,
          cost_usd: usage.costUsd,
          model: usage.model || null,
          effort: usage.effort || null,
          updated_at: new Date().toISOString(),
        })
        .eq("run_id", b.runId)
        .eq("case_id", c.id);
      return Response.json({ status: result.status, progress: result.progress, metrics: result.metrics ?? null, costUsd: usage.costUsd });
    }

    if (b.action === "finish-run") {
      const { data: rows } = await svc
        .from("regression_run_cases")
        .select("status, cost_usd, metrics, regression_cases(code, kind)")
        .eq("run_id", b.runId);
      const list = (rows ?? []) as unknown as { status: string; cost_usd: number; metrics: unknown; regression_cases: { code: string; kind: string } }[];
      const summary = {
        cases: list.length,
        passed: list.filter((r) => r.status === "passed").length,
        failed: list.filter((r) => r.status === "failed").length,
        errors: list.filter((r) => r.status === "error").length,
        costUsd: Math.round(list.reduce((s, r) => s + Number(r.cost_usd || 0), 0) * 1e6) / 1e6,
        perCase: list.map((r) => ({ code: r.regression_cases.code, kind: r.regression_cases.kind, status: r.status, metrics: r.metrics, costUsd: Number(r.cost_usd) })),
      };
      await svc.from("regression_runs").update({ status: "finished", finished_at: new Date().toISOString(), summary }).eq("id", b.runId);
      return Response.json({ summary });
    }

    if (b.action === "abandon-run") {
      await svc.from("regression_runs").update({ status: "abandoned", finished_at: new Date().toISOString() }).eq("id", b.runId).eq("status", "running");
      return Response.json({ ok: true });
    }

    if (b.action === "copy-fixtures") return Response.json(await copyFixtures(svc, b.assessmentId));
    if (b.action === "create-cases") return Response.json(await createCases(svc, b.assessmentId, b.kinds, admin));
    if (b.action === "revoke") return Response.json(await revokeFixtures(svc, b.assessmentId));

    // old-data-check: one teacher per request, in a stable order.
    const { data: owners } = await svc.from("teacher_workspaces").select("owner_id").order("owner_id");
    const ids = (owners ?? []).map((o) => o.owner_id as string);
    if (b.index >= ids.length) return Response.json({ done: true, teachers: ids.length });
    const teacher = ids[b.index];
    const { data: raw, error } = await svc.rpc("get_workspace_json", { p_teacher: teacher });
    const report = error
      ? { loadError: "get_workspace_json failed", assessments: [] as unknown[] }
      : checkWorkspace(raw, (w: Workspace) => normalizeWorkspace(w), anon(teacher));
    return Response.json({ done: false, teachers: ids.length, index: b.index, teacher: anon("t")(teacher), ...report });
  } catch (e) {
    if (e instanceof CaseRefused) return Response.json({ error: e.message }, { status: 400 });
    return apiError(e);
  }
}
