import { cookies, headers } from "next/headers";
import { HttpError } from "@/lib/http-error";
import {
  impersonationRefusal,
  type GuardedAction,
} from "@/lib/impersonation-guard";
import { countPages, contentHash } from "@/lib/page-count";
import { canonicalHost, hostGuardEnforced } from "@/lib/canonical-host";

export { HttpError };
import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { Workspace } from "@/lib/teacher-types";

type Statement = {
  bind: (...values: unknown[]) => Statement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  run: () => Promise<{ meta: { changes: number } }>;
};
type Binding = {
  prepare: (sql: string) => Statement;
  batch: (statements: Statement[]) => Promise<unknown>;
};

type DocumentRecord = {
  id: string;
  ownerId: string;
  name: string;
  objectPath: string;
  mime: string;
  size: number;
  bytes: ArrayBuffer;
};

const DOCUMENT_BUCKET = "teacher-documents";

async function sitesRuntimeEnv() {
  try {
    return (await import("cloudflare:workers")).env;
  } catch {
    throw new HttpError(
      503,
      "Classroom sign-in and storage are not connected on this host yet.",
    );
  }
}

async function sitesDatabase(): Promise<Binding> {
  const env = await sitesRuntimeEnv();
  if (!env.DB) throw new Error("Storage is temporarily unavailable.");
  return env.DB as unknown as Binding;
}

async function sitesBucket() {
  const env = await sitesRuntimeEnv();
  if (!env.BUCKET)
    throw new Error("Document storage is temporarily unavailable.");
  return env.BUCKET;
}

export async function owner() {
  if (hasSupabaseConfig()) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    const id = data?.claims?.sub;
    if (error || !id)
      throw new HttpError(401, "Please sign in to open your classroom.");
    return id;
  }

  await sitesRuntimeEnv();
  const requestHeaders = await headers();
  const id = requestHeaders.get("oai-authenticated-user-id");
  if (!id) throw new HttpError(401, "Please sign in to open your classroom.");
  return id;
}

export function authProvider() {
  return hasSupabaseConfig() ? "supabase" : "chatgpt";
}

// Cookie name shared with app/admin/actions.ts (startImpersonation /
// stopImpersonation) and app/api/impersonation/route.ts (the "who am I
// viewing" check the teacher app banner reads).
export const IMPERSONATION_COOKIE = "tbf_impersonate";

export type OwningIdentity = {
  id: string;
  impersonating: boolean;
  realId: string;
};

/**
 * The teacher id a request should act on. Almost always the signed-in
 * user's own id (owner()); when an app manager has an active "view as"
 * session running (see startImpersonation in lib/impersonation-actions.ts),
 * resolves to the teacher being viewed instead.
 *
 * Only the teacher-facing routes (workspace/scan/uploads/quota) use this
 * (via owningTeacherId(), below). Admin pages and server actions call
 * owner() directly and are never impersonation-aware — /admin access
 * always reflects who is really signed in, so an app manager viewing a
 * non-admin teacher's workspace never loses their own admin access, and
 * impersonating an account never grants that account's admin status
 * either way.
 */
export async function resolveOwningTeacher(): Promise<OwningIdentity> {
  const realId = await owner();
  if (hasSupabaseConfig()) {
    try {
      const cookieStore = await cookies();
      const session = cookieStore.get(IMPERSONATION_COOKIE)?.value;
      if (session) {
        const { data, error } = await createServiceClient().rpc(
          "resolve_impersonation",
          { p_session: session, p_actor: realId },
        );
        if (!error && data)
          return { id: data as string, impersonating: true, realId };
      }
    } catch {
      // Any failure here just falls through to the real identity below —
      // impersonation is a convenience, never a way to break the app.
    }
  }
  return { id: realId, impersonating: false, realId };
}

export async function owningTeacherId() {
  return (await resolveOwningTeacher()).id;
}

/**
 * Refuses outright while a "view as" session is in play. The one place that
 * knows about the cookie; lib/impersonation-guard.ts holds which actions are
 * refused and what each one says.
 *
 * It tests for the cookie's PRESENCE, not for whether the session still
 * resolves, and that distinction is the whole point. A session expires after
 * 30 minutes. If it lapses while an app manager is mid-view, the browser is
 * still holding the teacher's classroom in memory, but resolveOwningTeacher()
 * has quietly fallen back to the manager's own id — so the next save would
 * write the teacher's students, evidence and assessments into the manager's
 * own account, and sync_workspace would then delete whatever the manager
 * actually owned. Refusing on the cookie means only an explicit "stop
 * viewing" (which clears it) can re-enable writing.
 */
export async function assertNotImpersonating(action: GuardedAction) {
  if (!hasSupabaseConfig()) return;
  const cookieStore = await cookies();
  const refusal = impersonationRefusal(
    cookieStore.get(IMPERSONATION_COOKIE)?.value,
    action,
  );
  if (refusal) throw new HttpError(403, refusal);
}

/**
 * The teacher id a WRITE may act on. Viewing another teacher's account is
 * strictly read-only; reads keep using owningTeacherId().
 */
export async function writingTeacherId() {
  await assertNotImpersonating("write");
  return (await resolveOwningTeacher()).id;
}

/**
 * The teacher id a DOWNLOAD may act on.
 *
 * Reads use owningTeacherId(), which resolves to the teacher being viewed --
 * that is the whole point of a view-as session. A download is not a read of
 * that kind. It hands the viewer a file containing every student name and
 * every piece of evidence in the account, the file outlives the session, and
 * nothing about it reaches admin_audit_log: the start of the view is logged,
 * the copy taken during it is not.
 *
 * So downloads refuse on the same cookie writes do. A school asking for a
 * teacher's data goes through GET /api/admin/export/[teacherId], which is
 * gated on is_admin() and writes an audit line naming the admin who took it.
 */
export async function downloadingTeacherId() {
  await assertNotImpersonating("download");
  return (await resolveOwningTeacher()).id;
}

/**
 * Rejects cross-origin writes. Behind Netlify's proxy request.url is an
 * internal address, so the site origin is rebuilt from the forwarded host
 * headers and the ALLOWED_ORIGINS allow-list instead of request.url.
 *
 * This used to add `${forwardedProto}://${forwardedHost}` -- the request's own
 * host -- to the allow-list unconditionally. That was the permalink hole: a
 * stale copy is same-origin with itself, so its own writes always passed. Now
 * the forwarded host is trusted only OUTSIDE production, where the host is
 * legitimately not canonical (deploy previews, branch deploys, localhost) and
 * there is nothing else to match against. In production the canonical host is
 * the only same-origin value, and proxy.ts has already refused a non-canonical
 * host before any route runs -- so this is defence in depth, not the only gate.
 */
export function guardOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return; // same-origin GETs, server-to-server
  const h = request.headers;
  const forwardedHost = h.get("x-forwarded-host") ?? h.get("host");
  const forwardedProto = h.get("x-forwarded-proto") ?? "https";
  const allowed = new Set<string>();
  const canonical = canonicalHost();
  if (canonical) allowed.add(`https://${canonical}`);
  // The request's own host is same-origin with itself, which is precisely why
  // it cannot be trusted in production. Outside production there is no canonical
  // host to compare to and the forwarded host is the legitimate one.
  if (!hostGuardEnforced() && forwardedHost)
    allowed.add(`${forwardedProto}://${forwardedHost}`);
  // Explicit allow-list from env, comma-separated, e.g.
  // https://ateachersbestfriend.com,https://www.ateachersbestfriend.com
  for (const o of (process.env.ALLOWED_ORIGINS ?? "").split(","))
    if (o.trim()) allowed.add(o.trim());
  try {
    // request.url is the internal proxy address in production, so this adds
    // nothing there; outside production it is the real dev origin.
    if (!hostGuardEnforced()) allowed.add(new URL(request.url).origin);
  } catch {
    // request.url can be relative or opaque behind a proxy; ignore it.
  }
  if (!allowed.has(origin))
    throw new HttpError(403, "This request could not be verified.");
}

/**
 * The site's own public origin, for building a redirect. Behind Netlify's
 * proxy request.url is an internal address (the same reason guardOrigin
 * cannot trust it), so a redirect resolved against it can point somewhere
 * the browser cannot reach. Prefer the forwarded host, then the first
 * configured origin, and only fall back to request.url.
 */
export function siteUrl(request: Request, path: string) {
  const h = request.headers;
  const forwardedHost = h.get("x-forwarded-host") ?? h.get("host");
  if (forwardedHost) {
    const proto = h.get("x-forwarded-proto") ?? "https";
    return new URL(path, `${proto}://${forwardedHost}`);
  }
  const configured = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .find(Boolean);
  return new URL(path, configured || request.url);
}

export function apiError(error: unknown) {
  if (error instanceof HttpError)
    return Response.json({ error: error.message }, { status: error.status });
  console.error(
    "Teacher workspace request failed",
    error instanceof Error ? error.name : "unknown",
  );
  return Response.json(
    {
      error:
        "We couldn’t complete that request. Your changes haven’t been discarded. Please try again.",
    },
    { status: 503 },
  );
}

export async function aiConfig() {
  if (hasSupabaseConfig()) {
    return {
      key: process.env.OPENAI_API_KEY || "",
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
    };
  }
  const env = (await sitesRuntimeEnv()) as unknown as Record<string, string>;
  return {
    key: env.OPENAI_API_KEY || "",
    model: env.OPENAI_MODEL || "gpt-5.6-luna",
  };
}

const RPC_FAILURE_MESSAGE =
  "We couldn’t complete that request. Your changes haven’t been discarded. Please try again.";

function rpcFailure(name: string, error: { code?: string; message: string }) {
  console.error(
    `Workspace RPC ${name} failed`,
    error.code ?? "",
    error.message,
  );
  return new HttpError(500, RPC_FAILURE_MESSAGE);
}

/**
 * Reads the workspace revision counter. This never touches the JSON blob:
 * the relational facade (get_workspace_json / sync_workspace) owns the
 * document, and the row only supplies the optimistic-concurrency revision.
 */
async function workspaceRevision(id: string) {
  const { data, error } = await createServiceClient()
    .from("teacher_workspaces")
    .select("revision")
    .eq("owner_id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? Number(data.revision) : null;
}

/**
 * Writes the full workspace through the sync_workspace RPC. There is no
 * fallback to the blob: if the RPC fails the request fails with a 500.
 */
async function syncWorkspace(id: string, workspace: Workspace) {
  const { error } = await createServiceClient().rpc("sync_workspace", {
    p_teacher: id,
    p_data: workspace,
  });
  if (error) throw rpcFailure("sync_workspace", error);
}

function numeric(value: unknown) {
  if (typeof value === "number") return value;
  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    !Number.isNaN(Number(value))
  )
    return Number(value);
  return value;
}

/**
 * get_workspace_json stores grade as text and strips false booleans, while
 * the client (and the PUT schema) expect the blob's numeric grade and an
 * explicit demo flag. Coerce those fields so the JSON the client receives
 * keeps the same shape it always had.
 */
// The relational facade's standards row only carries code/title/subject/
// grade/domain/cluster/wording/framework — it never stored the AI-enriched
// fields (skills, prerequisites, next, vocabulary, misconception, example,
// dok, source) sync_workspace's custom-standards insert doesn't persist
// them either. The client's Standard type treats all of those as required
// (e.g. StandardsView does `s.skills.length`), so a standard coming back
// from the database without defaults crashes the Standards page the
// moment it renders one. Fill in safe fallbacks here, once, for both
// customStandards and sharedStandards.
function normalizeStandard(item: Record<string, unknown>) {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    ...item,
    grade: numeric(item.grade),
    summary: item.summary ?? item.wording ?? "",
    skills: arr(item.skills),
    prerequisites: arr(item.prerequisites),
    next: arr(item.next),
    vocabulary: arr(item.vocabulary),
    misconception:
      item.misconception ??
      "Use the student’s written reasoning to identify the step that needs support.",
    example: item.example ?? "Choose a task that directly demonstrates this standard.",
    dok: typeof item.dok === "number" ? item.dok : 2,
    source: item.source ?? "",
  };
}

function normalizeWorkspace(data: Workspace): Workspace {
  const record = data as unknown as Record<string, unknown>;
  const list = (key: string) =>
    Array.isArray(record[key])
      ? (record[key] as Record<string, unknown>[])
      : [];
  const settings = (record.settings ?? {}) as Partial<Workspace["settings"]>;
  return {
    ...data,
    classes: list("classes").map((item) => ({
      ...item,
      grade: numeric(item.grade),
      demo: Boolean(item.demo),
    })),
    assessments: list("assessments").map((item) => ({
      ...item,
      grade: numeric(item.grade),
    })),
    // The relational facade returns an empty student note as null, but the
    // client and the save schema treat notes as a plain string. Coerce it so a
    // teacher can always save their classroom.
    students: list("students").map((item) => ({
      ...item,
      notes: typeof item.notes === "string" ? item.notes : "",
    })),
    customStandards: list("customStandards").map(normalizeStandard),
    sharedStandards: list("sharedStandards").map(normalizeStandard),
    settings: {
      ...settings,
      teacherName: settings.teacherName ?? "",
      school: settings.school ?? "",
      reduceMotion: Boolean(settings.reduceMotion),
    },
  } as Workspace;
}

export async function readWorkspace(id: string) {
  if (hasSupabaseConfig()) {
    // Revision first: a save landing between the two reads then surfaces as
    // a 409 on the next PUT instead of silently overwriting newer data.
    const revision = await workspaceRevision(id);
    if (revision === null) return null;
    const { data, error } = await createServiceClient().rpc(
      "get_workspace_json",
      { p_teacher: id },
    );
    if (error) throw rpcFailure("get_workspace_json", error);
    return { data: normalizeWorkspace(data as Workspace), revision };
  }

  const row = await (await sitesDatabase())
    .prepare("SELECT data,revision FROM teacher_workspaces WHERE owner_id=?")
    .bind(id)
    .first<{ data: string; revision: number }>();
  return row ? { data: JSON.parse(row.data), revision: row.revision } : null;
}

export async function initializeWorkspace(id: string, workspace: Workspace) {
  if (hasSupabaseConfig()) {
    await syncWorkspace(id, workspace);
    return readWorkspace(id);
  }

  const db = await sitesDatabase();
  await db
    .prepare(
      "INSERT OR IGNORE INTO teacher_workspaces (owner_id,data,revision,updated_at) VALUES (?,?,0,?)",
    )
    .bind(id, JSON.stringify(workspace), new Date().toISOString())
    .run();
  return readWorkspace(id);
}

export async function updateWorkspace(
  id: string,
  workspace: Workspace,
  revision: number,
) {
  if (hasSupabaseConfig()) {
    const current = await workspaceRevision(id);
    if (current === null || current !== revision) return null;
    await syncWorkspace(id, workspace);
    return (await workspaceRevision(id)) ?? revision + 1;
  }

  const result = await (await sitesDatabase())
    .prepare(
      "UPDATE teacher_workspaces SET data=?,revision=revision+1,updated_at=? WHERE owner_id=? AND revision=?",
    )
    .bind(JSON.stringify(workspace), new Date().toISOString(), id, revision)
    .run();
  return result.meta.changes ? revision + 1 : null;
}

export async function replaceWorkspace(id: string, workspace: Workspace) {
  if (hasSupabaseConfig()) {
    await syncWorkspace(id, workspace);
    return;
  }

  await (await sitesDatabase())
    .prepare(
      "UPDATE teacher_workspaces SET data=?,revision=revision+1,updated_at=? WHERE owner_id=?",
    )
    .bind(JSON.stringify(workspace), new Date().toISOString(), id)
    .run();
}

export async function saveDocument(
  ownerId: string,
  id: string,
  file: File,
  bytes: ArrayBuffer,
) {
  const objectPath = `${ownerId}/${id}`;
  // Before the file is stored, not after: a PDF that cannot be parsed is
  // rejected here, so nothing lands in the bucket that the ledger cannot price.
  const [pageCount, sha256] = await Promise.all([
    countPages(file.type, bytes),
    contentHash(bytes),
  ]);
  if (hasSupabaseConfig()) {
    const supabase = await createClient();
    const { error: uploadError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .upload(objectPath, bytes, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { error: rowError } = await supabase.from("teacher_uploads").insert({
      id,
      owner_id: ownerId,
      name: file.name.slice(0, 180),
      object_path: objectPath,
      mime: file.type,
      size: file.size,
      // Both worked out from the bytes on this side of the wire. See
      // lib/page-count.ts: page count is what the teacher is charged, and the
      // hash is what stops the same page being charged twice.
      page_count: pageCount,
      content_sha256: sha256,
      created_at: new Date().toISOString(),
    });
    if (rowError) {
      await supabase.storage.from(DOCUMENT_BUCKET).remove([objectPath]);
      throw rowError;
    }
    return { pageCount, sha256 };
  }

  const bucket = await sitesBucket();
  await bucket.put(objectPath, bytes, {
    httpMetadata: { contentType: file.type },
  });
  try {
    await (await sitesDatabase())
      .prepare(
        "INSERT INTO teacher_uploads (id,owner_id,name,object_key,mime,size,created_at) VALUES (?,?,?,?,?,?,?)",
      )
      // No page_count or content_sha256 here: the Sites host has no plans and
      // no ledger, so there is nothing to meter and no column to put them in.
      .bind(
        id,
        ownerId,
        file.name.slice(0, 180),
        objectPath,
        file.type,
        file.size,
        new Date().toISOString(),
      )
      .run();
  } catch (error) {
    await bucket.delete(objectPath);
    throw error;
  }
  return { pageCount, sha256 };
}

export async function readDocument(
  ownerId: string,
  id: string,
): Promise<DocumentRecord | null> {
  if (hasSupabaseConfig()) {
    const supabase = await createClient();
    const { data: row, error } = await supabase
      .from("teacher_uploads")
      .select("id, owner_id, name, object_path, mime, size")
      .eq("id", id)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (error) throw error;
    if (!row) return null;
    const { data: object, error: objectError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .download(row.object_path);
    if (objectError || !object) return null;
    return {
      id: row.id,
      ownerId: row.owner_id,
      name: row.name,
      objectPath: row.object_path,
      mime: row.mime,
      size: row.size,
      bytes: await object.arrayBuffer(),
    };
  }

  const row = await (await sitesDatabase())
    .prepare(
      "SELECT id,owner_id,name,object_key,mime,size FROM teacher_uploads WHERE id=? AND owner_id=?",
    )
    .bind(id, ownerId)
    .first<{
      id: string;
      owner_id: string;
      name: string;
      object_key: string;
      mime: string;
      size: number;
    }>();
  if (!row) return null;
  const object = await (await sitesBucket()).get(row.object_key);
  if (!object) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    objectPath: row.object_key,
    mime: row.mime,
    size: row.size,
    bytes: await object.arrayBuffer(),
  };
}

export async function deleteDocument(ownerId: string, id: string) {
  if (hasSupabaseConfig()) {
    const supabase = await createClient();
    const { data: row, error } = await supabase
      .from("teacher_uploads")
      .select("object_path")
      .eq("id", id)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (error) throw error;
    if (!row) return false;
    const { error: objectError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .remove([row.object_path]);
    if (objectError) throw objectError;
    const { error: deleteError } = await supabase
      .from("teacher_uploads")
      .delete()
      .eq("id", id)
      .eq("owner_id", ownerId);
    if (deleteError) throw deleteError;
    return true;
  }

  const db = await sitesDatabase();
  const row = await db
    .prepare("SELECT object_key FROM teacher_uploads WHERE id=? AND owner_id=?")
    .bind(id, ownerId)
    .first<{ object_key: string }>();
  if (!row) return false;
  await (await sitesBucket()).delete(row.object_key);
  await db
    .prepare("DELETE FROM teacher_uploads WHERE id=? AND owner_id=?")
    .bind(id, ownerId)
    .run();
  return true;
}

export async function deleteAllDocuments(ownerId: string) {
  if (hasSupabaseConfig()) {
    const supabase = await createClient();
    const { data: rows, error } = await supabase
      .from("teacher_uploads")
      .select("object_path")
      .eq("owner_id", ownerId);
    if (error) throw error;
    const paths = (rows || []).map((row) => row.object_path);
    if (paths.length) {
      const { error: objectError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .remove(paths);
      if (objectError) throw objectError;
    }
    const { error: deleteError } = await supabase
      .from("teacher_uploads")
      .delete()
      .eq("owner_id", ownerId);
    if (deleteError) throw deleteError;
    return;
  }

  const db = await sitesDatabase();
  const rows = await db
    .prepare("SELECT object_key FROM teacher_uploads WHERE owner_id=?")
    .bind(ownerId)
    .all<{ object_key: string }>();
  const bucket = await sitesBucket();
  for (const row of rows.results) await bucket.delete(row.object_key);
  await db
    .prepare("DELETE FROM teacher_uploads WHERE owner_id=?")
    .bind(ownerId)
    .run();
}
