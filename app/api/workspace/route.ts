import { z } from "zod";
import {
  writingTeacherId,
  resolveOwningTeacher,
  guardOrigin,
  apiError,
  HttpError,
  aiConfig,
  authProvider,
  readWorkspace,
  initializeWorkspace,
  updateWorkspace,
  replaceWorkspace,
  deleteAllDocuments,
} from "@/lib/teacher-server";
import { createDemoWorkspace } from "@/lib/teacher-data";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Workspace } from "@/lib/teacher-types";

// Optional text the relational facade can legitimately store as NULL. The
// facade now coalesces these (see the workspace_json_defaults migration), but
// a workspace saved by an older client, or the ChatGPT Sites blob backend, can
// still carry null or a missing key — and a required z.string() there rejects
// the ENTIRE classroom with one generic message. Accept it and store "".
const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? "");

const dataSchema = z.object({
  classes: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        grade: z.number(),
        framework: z.string(),
        // A class that predates the demo-flag fix can omit this entirely.
        demo: z.boolean().nullish().transform((value) => Boolean(value)),
      }),
    )
    .min(1)
    .max(30),
  activeClassId: z.string(),
  students: z
    .array(
      z.object({
        id: z.string(),
        classId: z.string(),
        name: z.string(),
        color: optionalText,
        evidence: z.array(
          z.object({
            id: z.string(),
            standard: optionalText,
            score: z.coerce.number().min(0).max(100).catch(0),
            date: z.string(),
            source: optionalText,
            assessmentId: z.string().optional(),
          }),
        ),
        notes: optionalText,
      }),
    )
    .max(3000),
  assessments: z
    .array(
      z
        .object({
          id: z.string(),
          classId: z.string(),
          questions: z.array(z.any()),
          responses: z.array(z.any()),
        })
        .passthrough(),
    )
    .max(300),
  lessons: z.array(z.any()).max(1000),
  resources: z.array(z.any()).max(1000),
  customStandards: z.array(z.any()).max(1000),
  groups: z.array(z.any()).max(300),
  settings: z.object({
    teacherName: z.string().max(100),
    school: z.string().max(200),
    reduceMotion: z.boolean(),
    theme: z.string().max(40).optional(),
  }),
});

export async function GET() {
  try {
    const identity = await resolveOwningTeacher();
    const id = identity.id;
    let saved = await readWorkspace(id);
    if (!saved) saved = await initializeWorkspace(id, createDemoWorkspace());
    if (!saved) throw new Error("The classroom could not be initialized.");
    let impersonating: { teacherEmail: string } | null = null;
    if (identity.impersonating) {
      const { data } = await supabaseAdmin().auth.admin.getUserById(id);
      impersonating = { teacherEmail: data?.user?.email ?? "this account" };
    }
    return Response.json(
      {
        workspace: saved.data,
        revision: saved.revision,
        aiReady: Boolean((await aiConfig()).key),
        authProvider: authProvider(),
        impersonating,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    guardOrigin(request);
    const id = await writingTeacherId();
    const text = await request.text();
    if (text.length > 3500000)
      throw new HttpError(
        413,
        "This classroom is too large to save in one update.",
      );
    const body = JSON.parse(text);
    // The shared standards library is server-owned: it is sent to the client
    // so the catalog can resolve codes, but sync_workspace never reads it back
    // and a teacher can never change it. Drop it before validating rather than
    // bounding it — an admin unlocking enough grades would otherwise push the
    // echoed array past any cap and fail every teacher's save at once.
    if (body && typeof body === "object" && body.workspace)
      delete body.workspace.sharedStandards;
    const parsed = z
      .object({
        workspace: dataSchema,
        revision: z.number().int().nonnegative(),
      })
      .safeParse(body);
    if (!parsed.success) {
      // Name the offending field. The previous message said only "some
      // classroom information is incomplete", which gave a teacher whose save
      // had started failing nothing at all to act on.
      const issue = parsed.error.issues[0];
      const where = issue?.path.join(".") || "the classroom";
      console.error(
        "Workspace save rejected",
        parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      );
      throw new HttpError(
        400,
        `This classroom couldn’t be saved because “${where}” is missing or invalid. Reload the page to pick up the latest version, then try again.`,
      );
    }
    const workspace = parsed.data.workspace as Workspace;
    const { revision } = parsed.data;
    if (!workspace.classes.some((item) => item.id === workspace.activeClassId))
      throw new HttpError(400, "Please select a classroom.");
    const nextRevision = await updateWorkspace(id, workspace, revision);
    if (nextRevision === null)
      throw new HttpError(
        409,
        "This classroom changed in another tab. Reload to see the latest version before saving.",
      );
    return Response.json({ revision: nextRevision });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    guardOrigin(request);
    const id = await writingTeacherId();
    await deleteAllDocuments(id);
    const workspace = createDemoWorkspace();
    workspace.classes = [
      {
        id: "my-class",
        name: "My classroom",
        grade: 4,
        framework: "California",
        demo: false,
      },
    ];
    workspace.activeClassId = "my-class";
    workspace.students = [];
    workspace.assessments = [];
    await replaceWorkspace(id, workspace);
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
