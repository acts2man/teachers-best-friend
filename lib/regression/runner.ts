import "server-only";
/**
 * The in-app regression replay: runs one stored case through the same code a
 * teacher's request goes through, one small step per HTTP request.
 *
 * WHAT IS SHARED WITH PRODUCTION (so a number here is a number about the app):
 *   - modelSettingsFor(mode): the live pipeline_config row, read the same way
 *   - buildPrompt / finalizeAnalysis: the same prompt text, schema and output
 *     validation (lib/analyze-shared.ts)
 *   - documentContent: pages sent exactly as the analyze route sends them
 *   - startModelBackground / getBackgroundResponse / responseText: the same
 *     request body, retries and result reading as the background path
 *   - planNameBatches / mergeNameReads, groupPagesByCapture,
 *     resolveScannedGroups: the name pass and name matching
 *   - planScanBatches / absorbGraded / shortGroups / retryBatch: grading
 *     batches and the short-batch re-ask, as gradeInBatches does them
 *   - normalizeRecognizedResponses: what would be saved for each answer
 * WHAT IS DELIBERATELY NOT:
 *   - no scans row, no page charge, no quota: this is our cost, recorded on
 *     regression_run_cases.cost_usd instead
 *   - no reuse: every replay is a fresh read (freshRead is set, and the reuse
 *     lookup is never called) -- reusing would measure the cache, not the model
 *
 * ONE STEP PER REQUEST. A class-scan batch takes ~30-45s of model time, more
 * than one Netlify function invocation is allowed (the route asks for 26s; see
 * docs/regression-replay.md for the limit). So a step either plans the case,
 * starts ONE background job (bounded by BACKGROUND_START_BUDGET_MS, 20s), or
 * polls ONE (bounded by POLL_BUDGET_MS, 18s), saves its progress in
 * regression_run_cases.state, and returns. The page calls again.
 */
import { createServiceClient } from "@/lib/supabase/service";
import {
  analyzeInput,
  buildPrompt,
  finalizeAnalysis,
  responseText,
  type AnalyzeParams,
  type Mode,
  type ModelSettings,
  type ResponsesResult,
} from "@/lib/analyze-shared";
import {
  documentContent,
  getBackgroundResponse,
  labelledContent,
  modelSettingsFor,
  startModelBackground,
  deleteBackgroundResponse,
} from "@/lib/analyze-server";
import { catalogFor } from "@/lib/teacher-catalog";
import {
  absorbGraded,
  absorbPartsReask,
  groupPagesByCapture,
  groupPagesByName,
  NAME_RETRY_DELAYS_MS,
  rosterMatchCount,
  partsShortfall,
  planPartsReask,
  settleShortParts,
  mergeNameReads,
  planNameBatches,
  planScanBatches,
  resolveScannedGroups,
  retryBatch,
  shortGroups,
  type GradedGroup,
  type NameSlice,
  type PageName,
  type ScanBatch,
} from "@/lib/teacher-class-scan";
import { activeQuestions, normalizeRecognizedResponses } from "@/lib/teacher-workflow";
import { expectedParts } from "@/lib/prompt-payload";
import type { Assessment, Student, Workspace } from "@/lib/teacher-types";
import { scoreAnswers, scoreKey, scoreNames, scoreStandards } from "./score";
import type { AssessmentSnapshot, Expected, ExpectedAnswers, ExpectedNames, RegressionCase } from "./types";

type Svc = ReturnType<typeof createServiceClient>;
export const FIXTURE_BUCKET = "regression-fixtures";
/** How many times a short grading batch is re-asked, as in gradeInBatches. */
const MAX_RETRIES = 2;
const TERMINAL_FAILURES = new Set(["failed", "cancelled", "canceled", "incomplete"]);

type Job = { providerId: string; model: string; effort: string };
type Usage = { costUsd: number; model: string; effort: string };

export type RunState =
  | { stage: "names"; slices: NameSlice[]; results: ({ pages?: PageName[]; failed?: boolean } | null)[]; cursor: number; job: Job | null; tries?: number[] }
  | {
      stage: "grade";
      batches: ScanBatch[];
      cursor: number;
      attempt: number;
      attemptBatch: ScanBatch | null;
      best: [number, GradedGroup][];
      graded: GradedGroup[];
      job: Job | null;
      /** True while a multi-part re-ask for this batch is out. */
      partsPhase?: boolean;
      /** Multi-part re-asks still to send after the current one. */
      partsQueue?: ScanBatch[];
    }
  | { stage: "assignment"; result: Record<string, unknown> | null; job: Job | null };

export type StepResult = {
  status: "running" | "passed" | "failed" | "error";
  /** Plain words for the replay page: what this step did. */
  progress: string;
  metrics?: Record<string, unknown>;
};

/** The assessment a prompt is built from: the snapshot, as an Assessment. */
function asAssessment(s: AssessmentSnapshot): Assessment {
  return { ...s, responses: [], uploadIds: [], classIds: [] } as Assessment;
}

/** The workspace a prompt is built from: the snapshot assessment, and the
 * shared and custom standards the teacher's live workspace resolves codes
 * against (standards are curriculum data, not student data). */
async function promptWorkspace(svc: Svc, c: RegressionCase): Promise<Workspace> {
  const { data } = await svc.rpc("get_workspace_json", { p_teacher: c.teacherId });
  const live = (data ?? {}) as Partial<Workspace>;
  const roster = c.expected.kind === "names" ? (c.expected as ExpectedNames).roster : [];
  return {
    classes: [],
    students: roster.map((r) => ({ id: r.id, classId: c.expected.assessment.classId, name: r.name, color: "#000", evidence: [], notes: "" })),
    assessments: [asAssessment(c.expected.assessment)],
    lessons: [],
    groups: [],
    resources: [],
    customStandards: live.customStandards ?? [],
    sharedStandards: live.sharedStandards ?? [],
    settings: { teacherName: "", school: "", reduceMotion: false } as Workspace["settings"],
    activeClassId: c.expected.assessment.classId,
  } as unknown as Workspace;
}

/** Request params as the app would send them, with a fresh read forced. */
function params(mode: Mode, a: AssessmentSnapshot, uploadIds: string[], extra: Partial<AnalyzeParams> = {}): AnalyzeParams {
  return analyzeInput.parse({
    mode,
    uploadIds,
    grade: a.grade,
    subject: a.subject,
    framework: a.framework,
    assessmentId: a.id,
    targetStandards: a.targetStandards,
    ...(a.passage ? { passage: a.passage } : {}),
    freshRead: true,
    ...extra,
  });
}

/** The copied photos, read back from the private bucket in the order given. */
async function fixtureContent(svc: Svc, c: RegressionCase, sourceIds: string[]) {
  const { data: rows, error } = await svc
    .from("regression_fixtures")
    .select("source_upload_id, object_path, mime")
    .eq("teacher_id", c.teacherId)
    .eq("assessment_legacy_id", c.assessmentLegacyId)
    .in("source_upload_id", sourceIds);
  if (error) throw new Error("Reading fixtures failed: " + error.message);
  const byId = new Map((rows ?? []).map((r) => [r.source_upload_id as string, r]));
  // In parallel: a start step has the same 26s as a teacher's request, and
  // twelve photos read one after another were most of it.
  return Promise.all(
    sourceIds.map(async (id) => {
      const row = byId.get(id);
      if (!row) throw new Error("A page of this case was never copied into the fixtures. Copy the photos again.");
      const { data: blob, error: dl } = await svc.storage.from(FIXTURE_BUCKET).download(row.object_path as string);
      if (dl || !blob) throw new Error("A fixture photo could not be read back.");
      return documentContent({ bytes: await blob.arrayBuffer(), mime: row.mime as string, name: "page" }) as Record<string, unknown>;
    }),
  );
}

async function pricing(svc: Svc) {
  const { data } = await svc.from("model_pricing").select("model, input_per_mtok, cached_input_per_mtok, output_per_mtok");
  return new Map((data ?? []).map((r) => [r.model as string, r]));
}

/** What one call cost, from its token usage and the model_pricing table. */
export function callCost(
  usage: ResponsesResult["usage"],
  price: { input_per_mtok: unknown; cached_input_per_mtok: unknown; output_per_mtok: unknown } | undefined,
): number {
  if (!usage || !price) return 0;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const fresh = (usage.input_tokens ?? 0) - cached;
  const cost =
    (fresh * Number(price.input_per_mtok) + cached * Number(price.cached_input_per_mtok) + (usage.output_tokens ?? 0) * Number(price.output_per_mtok)) /
    1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}

/**
 * Starts the job, or polls the one already running. Returns the finalized
 * output once the model is done, or null while it is still working.
 */
async function advanceJob(
  svc: Svc,
  c: RegressionCase,
  key: string,
  job: Job | null,
  p: AnalyzeParams,
  sourceIds: string[],
  usage: Usage,
  setJob: (j: Job | null) => void,
): Promise<Record<string, unknown> | null> {
  const prompt = async () => {
    const w = await promptWorkspace(svc, c);
    return { w, catalog: catalogFor(w, p.grade, p.framework, p.subject) };
  };
  if (!job) {
    const { w, catalog } = await prompt();
    const settings: ModelSettings = await modelSettingsFor(p.mode);
    const content = labelledContent(p.mode, await fixtureContent(svc, c, sourceIds));
    const { task, schema } = buildPrompt(p, w, catalog, content.length > 0);
    content.push({ type: "input_text", text: task });
    const started = await startModelBackground(settings, content, p.mode, schema, key);
    setJob({ providerId: started.value, model: settings.model, effort: settings.effort });
    usage.model = settings.model;
    usage.effort = settings.effort;
    return null;
  }
  let remote: ResponsesResult;
  try {
    remote = await getBackgroundResponse(job.providerId, key);
  } catch {
    // A failed poll is not a failed job: the job is still running (and costing)
    // at the provider. Say "still working" and poll again next step, as the
    // teacher's client does, rather than abandoning a paid job.
    return null;
  }
  const status = remote.status ?? "in_progress";
  if (status !== "completed" && !TERMINAL_FAILURES.has(status)) return null;
  const price = (await pricing(svc)).get(job.model);
  usage.costUsd += callCost(remote.usage, price);
  usage.model = job.model;
  usage.effort = job.effort;
  setJob(null);
  await deleteBackgroundResponse(job.providerId, key);
  if (status !== "completed") throw new Error(`The model stopped (${status}${remote.incomplete_details?.reason ? ": " + remote.incomplete_details.reason : ""}).`);
  const text = responseText(remote);
  if (!text) throw new Error("The model returned no output.");
  const { w, catalog } = await prompt();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Never pass the parser's message on: it quotes the model's output.
    throw new Error("The model's output was not valid JSON.");
  }
  return finalizeAnalysis(p, parsed, w, catalog);
}

/**
 * What the app decided for each TRUE pile, given the groups it actually drew.
 * A pile is credited only when its pages are exactly one group; a group that
 * swallowed part of another pile, or was split, is not a right answer even if
 * its name matched.
 */
export function pilesAsResolved(
  piles: { pages: string[] }[],
  groups: number[][],
  resolved: { studentId: string | null; suggestedId: string | null }[],
) {
  let start = 0;
  return piles.map((pile) => {
    const own = pile.pages.map((_, i) => start + i);
    start += pile.pages.length;
    const gi = groups.findIndex((g) => g.includes(own[0]));
    const g = groups[gi] ?? [];
    const exact = g.length === own.length && own.every((x) => g.includes(x));
    const r = resolved[gi];
    if (!r) return { studentId: null, suggestedId: null };
    // Not exactly this pile: credit nothing; keep a pre-fill as the
    // (wrong) answer it is, so a confident mistake is still counted.
    return exact ? r : { studentId: r.studentId ? "\u0000wrong-pile" : null, suggestedId: null };
  });
}

function stageFor(e: Expected): RunState["stage"] {
  return e.kind === "names" ? "names" : e.kind === "answer_key" || e.kind === "standards" ? "assignment" : "grade";
}

/** The first state of a case: its requests, planned exactly as the app plans them. */
export async function planCase(svc: Svc, c: RegressionCase): Promise<RunState> {
  const e = c.expected;
  const stage = stageFor(e);
  if (stage === "assignment") return { stage, result: null, job: null };
  const piles = (e as ExpectedNames | ExpectedAnswers).piles;
  if (stage === "names") {
    const strips = piles.flatMap((p) => p.strips);
    const declared = (e as ExpectedNames).pilesDeclared !== false;
    const slices = planNameBatches(strips, declared ? groupPagesByCapture(piles.map((p) => p.pages.length)) : null);
    return { stage, slices, results: slices.map(() => null), cursor: 0, job: null };
  }
  const pages = piles.flatMap((p) => p.pages);
  const groups = groupPagesByCapture(piles.map((p) => p.pages.length));
  const { data: sizes } = await svc
    .from("regression_fixtures")
    .select("source_upload_id, size_bytes")
    .eq("teacher_id", c.teacherId)
    .eq("assessment_legacy_id", c.assessmentLegacyId);
  const bytes = new Map((sizes ?? []).map((r) => [r.source_upload_id as string, Number(r.size_bytes) || undefined]));
  const batches = planScanBatches(
    groups,
    pages,
    activeQuestions(asAssessment(e.assessment)).length,
    undefined,
    undefined,
    pages.map((id) => bytes.get(id)),
  );
  return { stage, batches, cursor: 0, attempt: 0, attemptBatch: null, best: [], graded: [], job: null };
}

/**
 * Advances one case by one step. `state` is what the last step saved; the new
 * state is written back by the caller along with `usage`.
 */
export async function stepCase(
  svc: Svc,
  c: RegressionCase,
  key: string,
  state: RunState,
  usage: Usage,
): Promise<{ state: RunState; result: StepResult }> {
  const e = c.expected;

  if (state.stage === "names") {
    const s = state;
    const names = e as ExpectedNames;
    if (s.cursor < s.slices.length) {
      const slice = s.slices[s.cursor];
      let out: Record<string, unknown> | null;
      try {
        out = await advanceJob(svc, c, key, s.job, params("name_strip", e.assessment, slice.map((x) => x.id)), slice.map((x) => x.id), usage, (j) => (s.job = j));
      } catch {
        // As in the class scan: a failed name read is tried again, twice (the
        // wait is the console's interval between steps, not the class scan's
        // 1.5 s / 4 s; the replay has no teacher waiting), and then leaves its
        // pages unread --
        // their own groups, for the teacher -- rather than stopping the case.
        s.job = null;
        const tries = (s.tries ??= []);
        tries[s.cursor] = (tries[s.cursor] ?? 0) + 1;
        out = tries[s.cursor] > NAME_RETRY_DELAYS_MS.length ? { failed: true } : null;
      }
      if (out) {
        s.results[s.cursor] = out as { pages?: PageName[]; failed?: boolean };
        s.cursor++;
      }
      return { state: s, result: { status: "running", progress: `Reading names: request ${Math.min(s.cursor + 1, s.slices.length)} of ${s.slices.length}` } };
    }
    const strips = names.piles.flatMap((p) => p.strips);
    const pages = names.piles.flatMap((p) => p.pages);
    const read = mergeNameReads(pages.length, s.slices, s.results.map((r) => r ?? {}));
    const declared = names.pilesDeclared !== false;
    const roster: Student[] = names.roster.map((r) => ({ id: r.id, classId: e.assessment.classId, name: r.name, color: "#000", evidence: [], notes: "" }));
    const groups = declared
      ? groupPagesByCapture(names.piles.map((p) => p.pages.length))
      : groupPagesByName(read, (name) => rosterMatchCount(name, roster));
    const resolved = resolveScannedGroups(groups, read, [], pages, roster, strips);
    const score = scoreNames(names.piles, pilesAsResolved(names.piles, groups, resolved));
    return { state: s, result: { status: score.passed ? "passed" : "failed", progress: "Names scored", metrics: { names: score } } };
  }

  if (state.stage === "grade") {
    const s = state;
    const answers = e as ExpectedAnswers;
    const a = asAssessment(e.assessment);
    const questionCount = activeQuestions(a).length;
    if (s.cursor < s.batches.length) {
      const batch = s.batches[s.cursor];
      const attemptBatch = s.attemptBatch ?? batch;
      let out: Record<string, unknown> | null;
      try {
        out = await advanceJob(
        svc, c, key, s.job,
        params("class_scan", e.assessment, attemptBatch.uploadIds, {
          pageGroups: attemptBatch.groups,
          batchIndex: s.cursor,
          onlyQuestionIds: attemptBatch.onlyQuestionIds ?? [],
        }),
        attemptBatch.uploadIds, usage, (j) => (s.job = j),
        );
      } catch (err) {
        // As in gradeInBatches: a failed multi-part re-ask does not fail the
        // batch; what is still short is settled to Unsure below.
        if (!s.partsPhase) throw err;
        s.job = null;
        out = { groups: [] };
      }
      if (out) {
        const best = new Map(s.best);
        const groups = (out as { groups?: GradedGroup[] }).groups;
        // The same order as gradeInBatches: missing students are re-asked
        // first, then short multi-part answers once, then anything still short
        // goes to Unsure.
        const missing = s.partsPhase ? [] : (absorbGraded(best, attemptBatch, groups), shortGroups(batch, best, questionCount));
        if (s.partsPhase) absorbPartsReask(best, attemptBatch, groups);
        const shorts = s.partsPhase ? [] : partsShortfall(a, batch.groupIndexes.map((at) => best.get(at)).filter((g): g is GradedGroup => !!g));
        const queue = s.partsPhase ? (s.partsQueue ?? []) : shorts.length ? planPartsReask(batch, shorts) : [];
        if (missing.length && s.attempt < MAX_RETRIES) {
          s.attempt++;
          s.attemptBatch = retryBatch(batch, missing);
          s.best = [...best];
        } else if (queue.length) {
          // One re-ask per step: each set of short questions is its own request.
          s.partsPhase = true;
          s.attemptBatch = queue[0];
          s.partsQueue = queue.slice(1);
          s.best = [...best];
        } else {
          settleShortParts(best, batch.groupIndexes, a);
          for (const at of batch.groupIndexes) {
            const g = best.get(at);
            if (g) s.graded.push(g);
          }
          s.cursor++;
          s.attempt = 0;
          s.attemptBatch = null;
          s.partsPhase = false;
          s.partsQueue = [];
          s.best = [];
        }
      }
      return { state: s, result: { status: "running", progress: `Grading: batch ${Math.min(s.cursor + 1, s.batches.length)} of ${s.batches.length}${s.attempt ? ` (re-ask ${s.attempt})` : ""}` } };
    }
    const replayed = answers.piles.flatMap((pile, i) => {
      const g = s.graded.find((x) => x.group === i);
      return normalizeRecognizedResponses(a, pile.studentId, g?.responses ?? []);
    });
    const parts = Object.fromEntries(activeQuestions(a).map((q) => [q.id, expectedParts(q)]));
    const scored = scoreAnswers(answers.answers, replayed, e.kind as "answer_reading" | "grouping", parts);
    // The page shows these side by side: give each its question number.
    const numberOf = new Map(a.questions.map((q) => [q.id, q.number]));
    const numbered = (l: typeof scored.partsMissing) => l.map((x) => ({ ...x, number: numberOf.get(x.questionId) }));
    const score = { ...scored, partsMissing: numbered(scored.partsMissing), needsHumanCheck: numbered(scored.needsHumanCheck) };
    return { state: s, result: { status: score.passed ? "passed" : "failed", progress: "Answers scored", metrics: { answers: score } } };
  }

  // assignment read: answer key and standards
  const s = state;
  if (e.kind !== "answer_key" && e.kind !== "standards") throw new Error("Unexpected case kind for an assignment read.");
  if (!s.result) {
    const out = await advanceJob(svc, c, key, s.job, params("assignment", e.assessment, e.worksheet), e.worksheet, usage, (j) => (s.job = j));
    if (out) s.result = out;
    return { state: s, result: { status: "running", progress: "Reading the worksheet" } };
  }
  const read = ((s.result.questions ?? []) as { number: number; answer: string; standard: string }[]).map((q) => ({
    number: Number(q.number),
    answer: String(q.answer ?? ""),
    standard: String(q.standard ?? ""),
  }));
  const score = e.kind === "answer_key" ? scoreKey(e.answers, read) : scoreStandards(e.standards, read);
  return { state: s, result: { status: score.passed ? "passed" : "failed", progress: "Scored", metrics: { [e.kind]: score } } };
}
