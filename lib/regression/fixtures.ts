import "server-only";
/**
 * Copying an assessment's photos into the private regression-fixtures bucket,
 * and making cases from what the teacher confirmed.
 *
 * Both refuse any assessment that is not on regression_fixture_allowlist: a set
 * is kept only after its teacher has said yes, and the allow-list row records
 * that. The copies are not teacher_uploads rows, so the 30-day upload purge
 * never touches them; removing the allow-list row (the "revoke" action) deletes
 * the files and, by cascade, the fixture rows and cases. Account deletion
 * removes them too (lib/account-deletion-server.ts).
 */
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeWorkspace } from "@/lib/teacher-server";
import type { Workspace } from "@/lib/teacher-types";
import { buildExpected, caseCode, CaseRefused, pairStrips, worksheetUploads, type UploadMeta } from "./expected";
import { FIXTURE_BUCKET } from "./runner";
import type { CaseKind } from "./types";

type Svc = ReturnType<typeof createServiceClient>;
const DOCUMENT_BUCKET = "teacher-documents";
/** Photos copied per request: each is a download and an upload of ~0.5 MB. */
const COPY_PER_REQUEST = 6;

export async function allowListed(svc: Svc, teacherId: string, assessmentLegacyId: string) {
  const { data, error } = await svc
    .from("regression_fixture_allowlist")
    .select("teacher_id")
    .eq("teacher_id", teacherId)
    .eq("assessment_legacy_id", assessmentLegacyId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/** Finds the allow-listed teacher for an assessment id. Legacy ids are only
 * unique per teacher, so more than one match is refused rather than guessed. */
export async function allowListEntry(svc: Svc, assessmentLegacyId: string) {
  const { data, error } = await svc
    .from("regression_fixture_allowlist")
    .select("teacher_id, assessment_legacy_id")
    .eq("assessment_legacy_id", assessmentLegacyId);
  if (error) throw error;
  if (!data?.length) throw new CaseRefused("That assessment is not on the allow-list. Its teacher has to agree first; see docs/regression-replay.md.");
  if (data.length > 1) throw new CaseRefused("More than one allow-listed teacher has an assessment with that id.");
  return data[0].teacher_id as string;
}

async function loadWorkspace(svc: Svc, teacherId: string): Promise<Workspace> {
  const { data, error } = await svc.rpc("get_workspace_json", { p_teacher: teacherId });
  if (error) throw error;
  return normalizeWorkspace(data as Workspace);
}

/** Every upload the assessment's cases can need, with the name-area copies
 * found next to the pages they were cut from. */
async function sourceUploads(svc: Svc, teacherId: string, w: Workspace, assessmentLegacyId: string) {
  const a = w.assessments.find((x) => x.id === assessmentLegacyId);
  if (!a) throw new CaseRefused("That assessment is not in the teacher's workspace.");
  const pages = [...new Set(Object.values(a.studentUploadIds ?? {}).flat())];
  const worksheet = worksheetUploads(a);
  const key = a.answerKeyUploadIds ?? [];
  const ids = [...new Set([...pages, ...worksheet, ...key])];
  const { data: rows, error } = await svc
    .from("teacher_uploads")
    .select("id, name, created_at, object_path, mime, size, content_sha256, purged_at")
    .eq("owner_id", teacherId)
    .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  if (error) throw error;
  const found = rows ?? [];
  // Name-area copies are not linked from the workspace; look next to the pages.
  const times = found.filter((r) => pages.includes(r.id)).map((r) => Date.parse(r.created_at));
  let strips: typeof found = [];
  if (times.length) {
    const from = new Date(Math.min(...times) - 60_000).toISOString();
    const to = new Date(Math.max(...times) + 120_000).toISOString();
    const { data: near, error: nearError } = await svc
      .from("teacher_uploads")
      .select("id, name, created_at, object_path, mime, size, content_sha256, purged_at")
      .eq("owner_id", teacherId)
      .gte("created_at", from)
      .lte("created_at", to)
      .like("name", "%-name.%");
    if (nearError) throw nearError;
    strips = near ?? [];
  }
  const meta: UploadMeta[] = [...found, ...strips].map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
  const pairs = pairStrips(meta);
  const role = (id: string) => (pages.includes(id) ? "page" : key.includes(id) ? "answer_key" : "worksheet");
  const ownerOf = new Map<string, string>();
  for (const [studentId, ids] of Object.entries(a.studentUploadIds ?? {})) for (const id of ids) ownerOf.set(id, studentId);
  const pageOfStrip = new Map([...pairs].map(([page, strip]) => [strip, page]));
  const wanted = [
    ...found.map((r) => ({ row: r, role: role(r.id), position: ids.indexOf(r.id), student: ownerOf.get(r.id) ?? null })),
    ...strips
      .filter((s) => pageOfStrip.has(s.id))
      .map((s) => {
        const page = pageOfStrip.get(s.id)!;
        return { row: s, role: "name_strip", position: pages.indexOf(page), student: ownerOf.get(page) ?? null };
      }),
  ];
  return { a, wanted, meta, missing: ids.filter((id) => !found.some((r) => r.id === id)) };
}

/**
 * Copies up to COPY_PER_REQUEST photos not yet copied, and says how many are
 * left. The page calls it until `remaining` is 0, so no request is long.
 */
export async function copyFixtures(svc: Svc, assessmentLegacyId: string) {
  const teacherId = await allowListEntry(svc, assessmentLegacyId);
  const w = await loadWorkspace(svc, teacherId);
  const { wanted } = await sourceUploads(svc, teacherId, w, assessmentLegacyId);
  const { data: done } = await svc
    .from("regression_fixtures")
    .select("source_upload_id")
    .eq("teacher_id", teacherId)
    .eq("assessment_legacy_id", assessmentLegacyId);
  const have = new Set((done ?? []).map((r) => r.source_upload_id as string));
  const todo = wanted.filter((x) => !have.has(x.row.id));
  const purged = todo.filter((x) => x.row.purged_at).length;
  let copied = 0;
  for (const x of todo.filter((t) => !t.row.purged_at).slice(0, COPY_PER_REQUEST)) {
    const { data: blob, error: dl } = await svc.storage.from(DOCUMENT_BUCKET).download(x.row.object_path);
    if (dl || !blob) continue;
    const path = `${teacherId}/${assessmentLegacyId}/${x.row.id}`;
    const { error: up } = await svc.storage
      .from(FIXTURE_BUCKET)
      .upload(path, await blob.arrayBuffer(), { contentType: x.row.mime, upsert: true });
    if (up) throw new Error("Copying a photo failed: " + up.message);
    const { error: ins } = await svc.from("regression_fixtures").upsert(
      {
        teacher_id: teacherId,
        assessment_legacy_id: assessmentLegacyId,
        source_upload_id: x.row.id,
        role: x.role,
        position: Math.max(0, x.position),
        object_path: path,
        content_sha256: x.row.content_sha256,
        mime: x.row.mime,
        size_bytes: x.row.size,
        student_legacy_id: x.student,
      },
      { onConflict: "teacher_id,assessment_legacy_id,source_upload_id" },
    );
    if (ins) {
      // No row, no record of the copy: remove it now, or nothing ever would.
      // This is also what happens if the teacher's agreement was withdrawn
      // ("delete my data") while this request was copying -- the row's foreign
      // key then refuses it (#128 round-3 review).
      await svc.storage.from(FIXTURE_BUCKET).remove([path]);
      throw new Error("Recording a copied photo failed: " + ins.message);
    }
    copied++;
  }
  const remaining = todo.filter((t) => !t.row.purged_at).length - copied;
  return { copied, remaining, purged, total: wanted.length };
}

/** Makes one case per kind from the teacher's confirmations. A kind the
 * teacher has not confirmed is skipped with its reason, never guessed. */
export async function createCases(svc: Svc, assessmentLegacyId: string, kinds: CaseKind[], createdBy: string, pilesDeclared = true) {
  const teacherId = await allowListEntry(svc, assessmentLegacyId);
  const w = await loadWorkspace(svc, teacherId);
  const { meta } = await sourceUploads(svc, teacherId, w, assessmentLegacyId);
  // Whose pages were copied: the record that survives the teacher confirming
  // (and so unlinking) a student's pages. Upload metadata for those pages is
  // added too, since unlinked pages are no longer found from the workspace.
  const { data: copied, error: copiedError } = await svc
    .from("regression_fixtures")
    .select("source_upload_id, student_legacy_id, role")
    .eq("teacher_id", teacherId)
    .eq("assessment_legacy_id", assessmentLegacyId);
  if (copiedError) throw copiedError;
  const copiedPages: Record<string, string[]> = {};
  for (const r of copied ?? [])
    if (r.role === "page" && r.student_legacy_id)
      (copiedPages[r.student_legacy_id] ??= []).push(r.source_upload_id);
  const known = new Set(meta.map((m) => m.id));
  const extra = (copied ?? []).map((r) => r.source_upload_id as string).filter((id) => !known.has(id));
  if (extra.length) {
    const { data: rows } = await svc
      .from("teacher_uploads")
      .select("id, name, created_at")
      .eq("owner_id", teacherId)
      .in("id", extra);
    for (const r of rows ?? []) meta.push({ id: r.id, name: r.name, createdAt: r.created_at });
  }
  const made: string[] = [];
  const skipped: { kind: CaseKind; reason: string }[] = [];
  for (const kind of kinds) {
    try {
      const built = buildExpected(kind, w, assessmentLegacyId, meta, Object.keys(copiedPages).length ? copiedPages : null);
      const expected = built.kind === "names" ? { ...built, pilesDeclared } : built;
      const code = caseCode();
      const { error } = await svc.from("regression_cases").insert({
        code,
        teacher_id: teacherId,
        assessment_legacy_id: assessmentLegacyId,
        kind,
        expected,
        source: "teacher-confirmed in app, snapshot " + new Date().toISOString().slice(0, 10),
        created_by: createdBy,
      });
      if (error) throw new Error(error.message);
      made.push(code);
    } catch (e) {
      skipped.push({ kind, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { made, skipped };
}

/** Withdraws a set: deletes its copied files, then the allow-list row (which
 * removes its fixture rows and cases by cascade). */
export async function revokeFixtures(svc: Svc, assessmentLegacyId: string) {
  const teacherId = await allowListEntry(svc, assessmentLegacyId);
  const { data: rows } = await svc
    .from("regression_fixtures")
    .select("object_path")
    .eq("teacher_id", teacherId)
    .eq("assessment_legacy_id", assessmentLegacyId);
  const paths = (rows ?? []).map((r) => r.object_path as string);
  if (paths.length) {
    const { error } = await svc.storage.from(FIXTURE_BUCKET).remove(paths);
    if (error) throw new Error("Removing the copied photos failed: " + error.message);
  }
  const { error } = await svc
    .from("regression_fixture_allowlist")
    .delete()
    .eq("teacher_id", teacherId)
    .eq("assessment_legacy_id", assessmentLegacyId);
  if (error) throw error;
  return { removed: paths.length };
}
