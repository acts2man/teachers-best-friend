/**
 * Builds a case's expected values from what the teacher confirmed in the app.
 *
 * Pure: it is handed the teacher's workspace (as get_workspace_json returns it)
 * and the upload rows, and returns the snapshot stored in regression_cases. The
 * teacher's confirmations ARE the ground truth -- which student each pile was
 * matched to, the credit given to each answer, the confirmed key, the standard
 * on each question -- and a case refuses to be made from anything the teacher
 * has not confirmed, so an unreviewed AI guess can never become "expected".
 */
import type { Assessment, Workspace } from "@/lib/teacher-types";
import type {
  AssessmentSnapshot,
  CaseKind,
  Expected,
  ExpectedPile,
} from "./types";

export type UploadMeta = { id: string; name: string; createdAt: string };

export class CaseRefused extends Error {}

/**
 * The blank worksheet's pages. `assignmentUploadIds` when the app recorded
 * them; otherwise `uploadIds` -- which a class scan also appends every student
 * page to -- minus the student pages and the answer-key pages.
 */
export function worksheetUploads(a: Assessment): string[] {
  if (a.assignmentUploadIds?.length) return [...a.assignmentUploadIds];
  const studentPages = new Set(Object.values(a.studentUploadIds ?? {}).flat());
  const keyPages = new Set(a.answerKeyUploadIds ?? []);
  return (a.uploadIds ?? []).filter((id) => !studentPages.has(id) && !keyPages.has(id));
}

export function snapshotAssessment(a: Assessment): AssessmentSnapshot {
  return {
    id: a.id,
    classId: a.classId,
    title: a.title,
    subject: a.subject,
    grade: a.grade,
    framework: a.framework,
    createdAt: a.createdAt,
    status: a.status,
    source: a.source,
    targetStandards: a.targetStandards ?? [],
    passage: a.passage,
    answerKeyVerified: a.answerKeyVerified,
    elaArea: a.elaArea,
    genre: a.genre,
    rubric: a.rubric,
    questions: a.questions,
  };
}

const STRIP = /^(.*)-name(\.[A-Za-z0-9]+)$/;

/**
 * Which name-area upload belongs to which page upload.
 *
 * The class scan uploads each page whole and then its top part as
 * "<page name>-name.<ext>" a moment later (lib/image-prep.ts). File names repeat
 * across scans -- every stack starts at scan-1-1 -- so a strip is paired with a
 * page only when it carries that page's name AND was uploaded within a minute
 * after it, nearest first, each strip used once.
 */
export function pairStrips(uploads: UploadMeta[]): Map<string, string> {
  const time = (u: UploadMeta) => Date.parse(u.createdAt);
  const strips = uploads.filter((u) => STRIP.test(u.name));
  const used = new Set<string>();
  const pairs = new Map<string, string>();
  const pages = uploads.filter((u) => !STRIP.test(u.name)).sort((a, b) => time(a) - time(b));
  for (const page of pages) {
    const candidates = strips
      .filter((s) => {
        const m = s.name.match(STRIP)!;
        const dt = time(s) - time(page);
        return !used.has(s.id) && m[1] + m[2] === page.name && dt >= 0 && dt <= 60_000;
      })
      .sort((a, b) => time(a) - time(b));
    if (candidates[0]) {
      used.add(candidates[0].id);
      pairs.set(page.id, candidates[0].id);
    }
  }
  return pairs;
}

/** The confirmed piles, in the order the papers were scanned. Within a pile the
 * pages go in upload order -- the order they were photographed. */
export function confirmedPiles(
  a: Assessment,
  uploads: UploadMeta[],
  strips: Map<string, string>,
): ExpectedPile[] {
  const byStudent = a.studentUploadIds ?? {};
  const created = new Map(uploads.map((u) => [u.id, Date.parse(u.createdAt)]));
  const order = [
    ...(a.studentOrder ?? []).filter((id) => byStudent[id]),
    ...Object.keys(byStudent).filter((id) => !(a.studentOrder ?? []).includes(id)),
  ];
  const piles = order
    .map((studentId) => {
      const pages = [...new Set(byStudent[studentId] ?? [])]
        .filter((id) => created.has(id))
        .sort((x, y) => created.get(x)! - created.get(y)!);
      return { studentId, pages, strips: pages.map((p) => strips.get(p) ?? null) };
    })
    .filter((p) => p.pages.length);
  // Scan order across students: by each pile's first page, which is the order
  // the stack was photographed in even where studentOrder is incomplete.
  return piles.sort((x, y) => created.get(x.pages[0])! - created.get(y.pages[0])!);
}

/** Builds the expected values for one kind of case, or throws CaseRefused with
 * the reason when the teacher has not confirmed what the case would test. */
export function buildExpected(
  kind: CaseKind,
  w: Workspace,
  assessmentId: string,
  uploads: UploadMeta[],
): Expected {
  const a = w.assessments.find((x) => x.id === assessmentId);
  if (!a) throw new CaseRefused("That assessment is not in the teacher's workspace.");
  const assessment = snapshotAssessment(a);
  const active = a.questions.filter((q) => !q.excluded);

  if (kind === "answer_key") {
    if (a.answerKeyVerified !== true) throw new CaseRefused("The teacher has not confirmed this answer key.");
    const worksheet = worksheetUploads(a);
    if (!worksheet.length) throw new CaseRefused("No worksheet pages are recorded for this assessment.");
    return {
      kind,
      assessment,
      worksheet,
      answers: active.map((q) => ({ number: q.number, questionId: q.id, answer: q.answer })),
    };
  }
  if (kind === "standards") {
    const tagged = active.filter((q) => q.verified && q.standard);
    if (!tagged.length) throw new CaseRefused("No question has a teacher-confirmed standard.");
    const worksheet = worksheetUploads(a);
    if (!worksheet.length) throw new CaseRefused("No worksheet pages are recorded for this assessment.");
    return {
      kind,
      assessment,
      worksheet,
      standards: tagged.map((q) => ({ number: q.number, questionId: q.id, standard: q.standard })),
    };
  }

  const piles = confirmedPiles(a, uploads, pairStrips(uploads));
  if (!piles.length) throw new CaseRefused("No scanned pages are linked to students on this assessment.");
  const onRoster = new Set(w.students.map((s) => s.id));
  const missing = piles.filter((p) => !onRoster.has(p.studentId)).length;
  if (missing)
    throw new CaseRefused(
      `${missing} of the scanned students are no longer on the roster, so who each paper belongs to cannot be confirmed.`,
    );

  if (kind === "names") {
    if (!piles.some((p) => p.strips.some(Boolean)))
      throw new CaseRefused("None of the pages has a name-area copy to read the name from.");
    const classIds = [a.classId, ...(a.classIds ?? [])];
    return {
      kind,
      assessment,
      piles,
      roster: w.students.filter((s) => classIds.includes(s.classId)).map((s) => ({ id: s.id, name: s.name })),
    };
  }

  // answer_reading / grouping: only answers the teacher confirmed.
  const pileStudents = new Set(piles.map((p) => p.studentId));
  const answers = a.responses
    .filter((r) => pileStudents.has(r.studentId) && r.verified && active.some((q) => q.id === r.questionId))
    .map((r) => ({
      studentId: r.studentId,
      questionId: r.questionId,
      finalAnswer: (r.finalAnswer ?? "").trim(),
      answer: r.answer ?? "",
      match: typeof r.match === "number" ? r.match : r.correct ? 100 : null,
      verified: r.verified,
    }));
  if (!answers.length) throw new CaseRefused("The teacher has not confirmed any graded answers on this assessment.");
  return { kind, assessment, piles, answers };
}

/** A label for a case that says nothing about whose it is. */
export function caseCode(random: () => number = Math.random): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(random() * alphabet.length)];
  return "case-" + s;
}
