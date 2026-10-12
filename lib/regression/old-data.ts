/**
 * The old-data safety check: does every assessment already in the database
 * still open, with every page, in the code that is deployed now?
 *
 * Each workspace goes through the same path a teacher's browser takes --
 * normalizeWorkspace (what /api/workspace serves) then withWorkspaceDefaults
 * (what the app applies on load) -- and then through the functions the
 * assessment screens run on open: preparation gaps, every question's answer
 * groups and summary, every student's review and report, the gradebook export
 * and the scan order. An assessment that throws anywhere in that is one a
 * teacher would see as a blank or crashed screen.
 *
 * "Lost pages" are upload ids that get_workspace_json returned but that are no
 * longer reachable after the app's own load step -- the #110 failure, where
 * older assessments opened with pages missing. It does NOT see a field that
 * sync_workspace/get_workspace_json themselves drop (it starts from their
 * output); that path is checked against the relational columns in SQL, see the
 * PR. Pages purged by the 30-day retention window are not counted here.
 *
 * Read-only, and reports counts and anonymised ids only.
 */
import { withWorkspaceDefaults } from "@/lib/workspace-safety";
import {
  gradebookCsv,
  groupAnswers,
  preparationGaps,
  questionSummary,
  studentReport,
  studentReview,
} from "@/lib/teacher-workflow";
import { inScanOrder } from "@/lib/teacher-class-scan";
import type { Assessment, Workspace } from "@/lib/teacher-types";

export type AssessmentCheck = {
  /** Anonymised: a hash of teacher + assessment id, never the id itself. */
  ref: string;
  threw: string | null;
  pagesStored: number;
  pagesLost: number;
};

type RawAssessment = Partial<Assessment> & Record<string, unknown>;

/** Every upload id an assessment refers to, however it is stored. */
export function pageRefs(a: RawAssessment): Set<string> {
  const ids = new Set<string>();
  const add = (v: unknown) => {
    if (Array.isArray(v)) for (const x of v) if (typeof x === "string" && x) ids.add(x);
  };
  add(a.uploadIds);
  add(a.answerKeyUploadIds);
  add(a.assignmentUploadIds);
  const byStudent = a.studentUploadIds;
  if (byStudent && typeof byStudent === "object")
    for (const v of Object.values(byStudent as Record<string, unknown>)) add(v);
  return ids;
}

/** Runs one workspace through the load path and the open path. `normalize` is
 * the server's normalizeWorkspace, passed in so this stays importable from a
 * test without the server's dependencies. */
export function checkWorkspace(
  raw: unknown,
  normalize: (w: Workspace) => Workspace,
  anonymise: (assessmentId: string) => string,
): { loadError: string | null; assessments: AssessmentCheck[] } {
  const rawAssessments = (Array.isArray((raw as { assessments?: unknown })?.assessments)
    ? (raw as { assessments: RawAssessment[] }).assessments
    : []) as RawAssessment[];
  let w: Workspace;
  try {
    w = withWorkspaceDefaults(normalize(raw as Workspace));
  } catch (e) {
    // The error's kind only: a message can quote the data that broke it.
    return { loadError: e instanceof Error ? e.name : "load failed", assessments: [] };
  }
  return {
    loadError: null,
    assessments: rawAssessments.map((ra, i) => {
      const id = typeof ra.id === "string" ? ra.id : "#" + i;
      const stored = pageRefs(ra);
      const loaded = w.assessments.find((x) => x.id === id);
      let threw: string | null = null;
      let after = new Set<string>();
      try {
        if (!loaded) throw new Error("assessment missing after load");
        after = pageRefs(loaded as RawAssessment);
        const students = w.students.filter((s) => [loaded.classId, ...(loaded.classIds ?? [])].includes(s.classId));
        preparationGaps(loaded);
        for (const q of loaded.questions) {
          groupAnswers(loaded, q.id);
          questionSummary(loaded, q.id);
        }
        for (const s of students) {
          studentReview(loaded, s.id);
          studentReport(loaded, s);
        }
        gradebookCsv(loaded, students);
        inScanOrder(students, loaded);
      } catch (e) {
        // The error's kind and code location only; the message could quote data.
        threw = e instanceof Error ? e.name + (e.stack?.split("\n")[1]?.trim().slice(0, 120) ? " at " + e.stack.split("\n")[1].trim().slice(0, 120) : "") : "threw";
      }
      const lost = [...stored].filter((x) => !after.has(x)).length;
      return { ref: anonymise(id), threw, pagesStored: stored.size, pagesLost: lost };
    }),
  };
}
