import { headers } from "next/headers";
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

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    // Optional internal detail (e.g. an upstream provider's status and error
    // body) recorded for diagnosis but never shown to the user.
    public detail?: string,
  ) {
    super(message);
  }
}

/**
 * Rejects cross-origin writes. Behind Netlify's proxy request.url is an
 * internal address, so the site origin is rebuilt from the forwarded host
 * headers and the ALLOWED_ORIGINS allow-list instead of request.url.
 */
export function guardOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return; // same-origin GETs, server-to-server
  const h = request.headers;
  const forwardedHost = h.get("x-forwarded-host") ?? h.get("host");
  const forwardedProto = h.get("x-forwarded-proto") ?? "https";
  const allowed = new Set<string>();
  if (forwardedHost) allowed.add(`${forwardedProto}://${forwardedHost}`);
  // Explicit allow-list from env, comma-separated, e.g.
  // https://ateachersbestfriend.com,https://www.ateachersbestfriend.com
  for (const o of (process.env.ALLOWED_ORIGINS ?? "").split(","))
    if (o.trim()) allowed.add(o.trim());
  try {
    allowed.add(new URL(request.url).origin);
  } catch {
    // request.url can be relative or opaque behind a proxy; ignore it.
  }
  if (!allowed.has(origin))
    throw new HttpError(403, "This request could not be verified.");
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
      model: process.env.OPENAI_MODEL || "gpt-6-astra",
    };
  }
  const env = (await sitesRuntimeEnv()) as unknown as Record<string, string>;
  return {
    key: env.OPENAI_API_KEY || "",
    model: env.OPENAI_MODEL || "gpt-6-astra",
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
    customStandards: list("customStandards").map((item) => ({
      ...item,
      grade: numeric(item.grade),
    })),
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
      created_at: new Date().toISOString(),
    });
    if (rowError) {
      await supabase.storage.from(DOCUMENT_BUCKET).remove([objectPath]);
      throw rowError;
    }
    return;
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
