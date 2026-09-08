import { z } from "zod";
import {
  owner,
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
import type { Workspace } from "@/lib/teacher-types";

const dataSchema = z.object({
  classes: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        grade: z.number(),
        framework: z.string(),
        demo: z.boolean(),
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
        color: z.string(),
        evidence: z.array(
          z.object({
            id: z.string(),
            standard: z.string(),
            score: z.number().min(0).max(100),
            date: z.string(),
            source: z.string(),
            assessmentId: z.string().optional(),
          }),
        ),
        notes: z.string(),
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
  }),
});

export async function GET() {
  try {
    const id = await owner();
    let saved = await readWorkspace(id);
    if (!saved) saved = await initializeWorkspace(id, createDemoWorkspace());
    if (!saved) throw new Error("The classroom could not be initialized.");
    return Response.json(
      {
        workspace: saved.data,
        revision: saved.revision,
        aiReady: Boolean((await aiConfig()).key),
        authProvider: authProvider(),
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
    const id = await owner();
    const text = await request.text();
    if (text.length > 3500000)
      throw new HttpError(
        413,
        "This classroom is too large to save in one update.",
      );
    const parsed = z
      .object({
        workspace: dataSchema,
        revision: z.number().int().nonnegative(),
      })
      .safeParse(JSON.parse(text));
    if (!parsed.success)
      throw new HttpError(
        400,
        "Some classroom information is incomplete. Please check your entries.",
      );
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
    const id = await owner();
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
