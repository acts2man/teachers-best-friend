/**
 * The workspace settings the save route accepts (app/api/workspace). A key not
 * listed here is DROPPED on save -- z.object strips unknown keys -- so a new
 * setting is added here as well as to Workspace["settings"]. Settings are
 * stored whole (teacher_workspaces.data -> 'settings'), so no migration.
 */
import { z } from "zod";

export const settingsSchema = z.object({
  teacherName: z.string().max(100),
  school: z.string().max(200),
  reduceMotion: z.boolean(),
  theme: z.string().max(40).optional(),
  lastGradingMode: z.enum(["percentage", "sbg"]).optional(),
  // The year the school year starts (2026 = 2026–27; lib/school-year.ts).
  schoolYear: z.number().int().min(2000).max(2100).optional(),
  // Overview's "Pick up where you left off" (lib/last-worked-on.ts). Named
  // here because z.object drops a key it does not list.
  lastWorkedOn: z
    .object({ classId: z.string().max(100), assessmentId: z.string().max(100), at: z.string().max(40) })
    .optional(),
});
