/**
 * "The LEA may access, correct, export, and delete LEA student data at any
 * time through the Service." -- content/legal/dpa.md, Section 5.
 *
 * Two files, built from what we store rather than from what the browser
 * happens to be holding:
 *
 *   - the whole workspace as JSON, for getting the data out intact
 *   - one CSV row per piece of standards evidence, for the thing a teacher
 *     actually does with it, which is open it in a spreadsheet
 *
 * Neither contains an image or a reference to one. Not because it would be
 * awkward to include them, but because they are already deleted: pages go when
 * the teacher confirms that student's grading, and at 30 days regardless. An
 * export that quietly named files that no longer exist would be worse than
 * one that says so.
 *
 * No imports beyond a type, so the test can bundle it on its own.
 */
import type { Workspace } from "@/lib/teacher-types";

/**
 * Keys that name an uploaded file. Stripped wherever they appear, at any
 * depth: Assessment carries four of them and Resource carries a fifth, and a
 * new one added later would otherwise ride out in the export unnoticed.
 */
export const UPLOAD_KEYS = [
  "uploadIds",
  "uploadId",
  "answerKeyUploadIds",
  "assignmentUploadIds",
  "studentUploadIds",
  "objectPath",
  "object_path",
] as const;

const STRIP = new Set<string>(UPLOAD_KEYS);

/** Deep copy with every upload reference removed. */
export function stripUploadRefs<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUploadRefs) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (STRIP.has(k)) continue;
      out[k] = stripUploadRefs(v);
    }
    return out as unknown as T;
  }
  return value;
}

export type ExportMeta = {
  /** ISO timestamp. Passed in rather than read, so the output is testable. */
  generatedAt: string;
};

/**
 * The JSON file. The workspace as the app holds it, minus upload references,
 * plus a short note explaining what is deliberately not in it.
 */
export function buildExportJson(w: Workspace, meta: ExportMeta) {
  const clean = stripUploadRefs(w) as Workspace;
  return {
    exportedAt: meta.generatedAt,
    application: "A Teacher's Best Friend",
    note:
      "Everything this account holds, apart from uploaded images and PDFs. " +
      "Those are deleted when you confirm a student's grading, and 30 days " +
      "after upload in any case, so there are none left to include.",
    counts: {
      classes: clean.classes?.length ?? 0,
      students: clean.students?.length ?? 0,
      assessments: clean.assessments?.length ?? 0,
      lessons: clean.lessons?.length ?? 0,
      resources: clean.resources?.length ?? 0,
      groups: clean.groups?.length ?? 0,
      customStandards: clean.customStandards?.length ?? 0,
    },
    workspace: clean,
  };
}

/** RFC 4180: quote anything with a comma, a quote or a newline in it. */
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export const CSV_HEADERS = [
  "class",
  "grade",
  "student",
  "standard",
  "score",
  "recorded_on",
  "source",
  "assessment",
] as const;

/**
 * One row per piece of evidence, and one row for a student who has none yet --
 * a roster with the quiet students missing from it is not a roster.
 */
export function buildExportCsv(w: Workspace): string {
  const classNames = new Map((w.classes ?? []).map((c) => [c.id, c]));
  const assessmentTitles = new Map(
    (w.assessments ?? []).map((a) => [a.id, a.title]),
  );
  const lines: string[] = [CSV_HEADERS.join(",")];

  for (const student of w.students ?? []) {
    const classroom = classNames.get(student.classId);
    const base = [classroom?.name ?? "", classroom?.grade ?? "", student.name];
    const evidence = student.evidence ?? [];
    if (evidence.length === 0) {
      lines.push([...base, "", "", "", "", ""].map(csvCell).join(","));
      continue;
    }
    for (const e of evidence) {
      lines.push(
        [
          ...base,
          e.standard ?? "",
          e.score ?? "",
          e.date ?? "",
          e.source ?? "",
          e.assessmentId ? (assessmentTitles.get(e.assessmentId) ?? "") : "",
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  // Trailing newline: a spreadsheet does not care, and every other tool does.
  return lines.join("\r\n") + "\r\n";
}
