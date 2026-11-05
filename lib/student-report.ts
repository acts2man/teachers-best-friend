/**
 * The printable student report (docs/design/super-grids.md section 4; Ricky,
 * 22 Oct 2026: "something that we can generate a summary report from for
 * teacher, parent conferences" and IEP meetings). Built in the browser from
 * the saved workspace: no AI call, nothing sent anywhere, so printing changes
 * nothing in docs/student-data-flow.md.
 *
 * It holds only this student's data, plus the class's average per cluster as
 * a number -- never another student's name, score or answer (Ricky, 27 Oct
 * 2026). Free text the report prints (test titles, evidence sources, the
 * teacher's notes) goes through `redactOthers`, which takes out any other
 * student's name on the teacher's roster, so a test called after a student or
 * a note that mentions a classmate cannot carry one onto the page.
 *
 * Sections: the student super grid with a class-average column, the common
 * error types, the Standard Tracker for the standards the teacher picks, and
 * the teacher's notes -- off unless they tick "include my notes". Laid out to
 * print on one or two Letter or A4 pages; the browser's "Save as PDF" makes
 * the PDF.
 */
import { gradingModeName, score4Text } from "./grading-mode";
import { localDateString, schoolYearLabel } from "./school-year";
import { classSuperGrid, studentSuperGrid, type Score, type SuperGridCell } from "./super-grid";
import { allStandards } from "./teacher-catalog";
import { evidenceShown, standardHeadline } from "./teacher-workflow";
import type { Classroom, Student, Workspace } from "./teacher-types";

export type ReportSections = { superGrid: boolean; tracker: boolean };

export type StudentReportOptions = {
  /** Standard codes for the Standard Tracker, in the order given. */
  standards: string[];
  /** The teacher's notes on the student. Off by default. */
  includeNotes?: boolean;
  /** Both on by default. */
  sections?: Partial<ReportSections>;
  now?: Date;
};

/** At most this many tracker standards fit the one-or-two-page layout. */
export const MAX_TRACKER_STANDARDS = 8;
/** Records shown per tracker standard: the latest ones. */
const TRACKER_ROWS = 6;

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ESC[c]);
const reEscape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Takes every other student's name on the teacher's roster (every class) out
 * of a piece of free text: their full name, and each word of it two letters or
 * longer ("Mo", not an initial "R."), whole words, any case -- except words this student's own name
 * shares. Safe before pretty: a test titled "Will it float?" loses "Will" if a
 * classmate is called Will.
 */
export function redactOthers(text: string, students: Pick<Student, "id" | "name">[], studentId: string): string {
  const own = students.find((s) => s.id === studentId);
  const ownWords = new Set((own?.name ?? "").toLowerCase().split(/[^\p{L}'’-]+/u).filter(Boolean));
  const names = new Set<string>();
  for (const s of students) {
    if (s.id === studentId) continue;
    const full = s.name.trim();
    if (full) names.add(full);
    for (const word of full.split(/[^\p{L}'’-]+/u)) if (word.length >= 2 && !ownWords.has(word.toLowerCase())) names.add(word);
  }
  let out = text;
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    if (own && name.toLowerCase() === own.name.trim().toLowerCase()) continue;
    out = out.replace(new RegExp("(?<![\\p{L}])" + reEscape(name) + "(?![\\p{L}])", "giu"), "another student");
  }
  return out;
}

const scoreText = (s: Score) => (s.score4 !== null ? score4Text(s.score4) + " / 4" : s.percent + "%");

function cellHtml(cell: SuperGridCell): string {
  if (!cell.questions) return '<td class="none">Not tested</td>';
  if (!cell.level) return '<td class="none">Not graded yet</td>';
  return (
    `<td class="lv-${cell.level.tone}"><strong>${escapeHtml(scoreText(cell))}</strong>` +
    `<span>${escapeHtml(cell.level.level)}</span>` +
    `<small>${cell.questions} question${cell.questions === 1 ? "" : "s"}</small></td>`
  );
}

/** The report as a whole HTML document, and its title. Pure. */
export function studentReportHtml(
  w: Pick<Workspace, "assessments" | "students" | "customStandards" | "sharedStandards" | "settings">,
  classroom: Pick<Classroom, "id" | "name" | "grade" | "gradingMode">,
  student: Pick<Student, "id" | "name" | "evidence" | "notes">,
  options: StudentReportOptions,
): { title: string; html: string } {
  const now = options.now ?? new Date();
  const sections: ReportSections = { superGrid: true, tracker: true, ...options.sections };
  const clean = (text: string) => escapeHtml(redactOthers(text, w.students, student.id));
  const grid = studentSuperGrid(w, classroom, student.id, now);
  const classRows = new Map(classSuperGrid(w, classroom, now).rows.map((r) => [r.cluster.key, r]));
  const catalog = allStandards(w);
  const title = student.name + " · Progress report";
  const parts: string[] = [];

  parts.push(
    `<header><h1>${escapeHtml(student.name)}</h1>` +
      `<p>${clean(classroom.name)} · Grade ${escapeHtml(String(classroom.grade))} · ${schoolYearLabel(grid.schoolYear)} school year · as of ${localDateString(now)}</p>` +
      `<p>From ${grid.tests} graded test${grid.tests === 1 ? "" : "s"} this school year · ${escapeHtml(gradingModeName(grid.mode))}</p></header>`,
  );

  if (sections.superGrid) {
    parts.push('<section class="grid"><h2>Student super grid</h2>');
    if (!grid.rows.length) parts.push("<p>No graded questions with a standard and a depth-of-knowledge level yet this school year.</p>");
    else {
      parts.push(
        "<table><thead><tr><th>Cluster</th><th>DOK 1<br><small>Recall</small></th><th>DOK 2<br><small>Skill / concept</small></th>" +
          "<th>DOK 3<br><small>Strategic thinking</small></th><th>DOK 4<br><small>Extended thinking</small></th>" +
          "<th>This student<br><small>all DOK</small></th><th>Class average<br><small>all DOK</small></th></tr></thead><tbody>",
      );
      for (const row of grid.rows) {
        const cls = classRows.get(row.cluster.key)?.overall;
        parts.push(
          `<tr><th scope="row">${escapeHtml(row.cluster.code ?? row.cluster.name ?? "Other standards")}` +
            (row.cluster.code && row.cluster.name ? `<small>${escapeHtml(row.cluster.name)}</small>` : "") +
            "</th>" +
            row.cells.map(cellHtml).join("") +
            `<td class="avg">${row.overall.level ? escapeHtml(scoreText(row.overall)) + `<span>${escapeHtml(row.overall.level.level)}</span>` : "—"}</td>` +
            `<td class="avg">${cls?.level ? escapeHtml(scoreText(cls)) + `<span>${escapeHtml(cls.level.level)}</span>` : "—"}</td></tr>`,
        );
      }
      parts.push("</tbody></table>");
      parts.push(
        '<p class="note">Each box: the score on every confirmed answer at that depth of knowledge, its level, and how many questions it rests on. ' +
          "A box on one or two questions is a hint, not a measure. The class average counts every student now in the class, as one number per cluster.</p>",
      );
    }
    if (grid.noDok) parts.push(`<p class="note">${grid.noDok} answered question${grid.noDok === 1 ? " has" : "s have"} no depth-of-knowledge level and ${grid.noDok === 1 ? "is" : "are"} not in the grid.</p>`);
    parts.push("</section>");

    const errors = new Map<string, number>();
    for (const row of grid.rows) for (const cell of row.cells) for (const e of cell.errorTypes) errors.set(e.name, (errors.get(e.name) ?? 0) + e.count);
    const common = [...errors].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
    parts.push('<section class="errors"><h2>Common error types</h2>');
    parts.push(
      common.length
        ? "<ul>" + common.map(([name, count]) => `<li><strong>${clean(name)}</strong> · ${count} answer${count === 1 ? "" : "s"}</li>`).join("") + "</ul>"
        : "<p>No error types tagged on these answers yet.</p>",
    );
    parts.push("</section>");
  }

  if (sections.tracker) {
    const codes = [...new Set(options.standards)].slice(0, MAX_TRACKER_STANDARDS);
    parts.push('<section class="tracker"><h2>Standard Tracker</h2>');
    if (!codes.length) parts.push("<p>No standards chosen.</p>");
    for (const code of codes) {
      const std = catalog.find((s) => s.code === code);
      const head = standardHeadline(w, student, code);
      const records = student.evidence
        .filter((e) => e.standard === code)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-TRACKER_ROWS);
      const headline =
        head.kind === "none"
          ? "No evidence yet"
          : head.kind === "sbg"
            ? head.text + " / 4 · " + head.level
            : head.percent + "% (latest three)" + (head.mixed ? " · 0–4 tests counted as score × 25" : "");
      parts.push(`<div class="std"><h3>${escapeHtml(code)}${std?.title ? " — " + clean(std.title) : ""}</h3><p class="headline">${escapeHtml(headline)}</p>`);
      if (records.length) {
        parts.push("<table><thead><tr><th>Date</th><th>From</th><th>Score</th></tr></thead><tbody>");
        for (const e of records) {
          const shown = evidenceShown(w, student.id, e);
          const test = e.assessmentId ? w.assessments.find((a) => a.id === e.assessmentId) : undefined;
          parts.push(
            `<tr><td>${escapeHtml(e.date)}</td><td>${clean(test?.title ?? e.source)}</td><td>${escapeHtml(shown.sbg ? shown.text : shown.percent + "%")}</td></tr>`,
          );
        }
        parts.push("</tbody></table>");
      }
      parts.push("</div>");
    }
    parts.push("</section>");
  }

  if (options.includeNotes && student.notes.trim())
    parts.push(`<section class="notes"><h2>Teacher&rsquo;s notes</h2><p>${clean(student.notes.trim())}</p></section>`);

  parts.push(
    "<footer>A progress summary from classroom tests, made by the teacher with A Teacher&rsquo;s Best Friend. " +
      "It is not an assessment of disability; an IEP team may use it as one input among many.</footer>",
  );

  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${REPORT_CSS}</style></head>` +
    `<body>${parts.join("")}</body></html>`;
  return { title, html };
}

const REPORT_CSS = [
  "@page{size:auto;margin:12mm}",
  "*{box-sizing:border-box}",
  "body{font:11px/1.45 Arial,Helvetica,sans-serif;color:#1f2d2a;margin:0 auto;max-width:190mm;padding:12mm 0}",
  "@media print{body{padding:0}}",
  "h1{font-size:20px;margin:0 0 2px}header{border-bottom:2px solid #1f2d2a;padding-bottom:6px;margin-bottom:10px}header p{margin:0;color:#4a5a56}",
  "h2{font-size:14px;margin:12px 0 6px}h3{font-size:12px;margin:8px 0 2px}",
  "table{width:100%;border-collapse:collapse;page-break-inside:auto;font-size:inherit}tr{page-break-inside:avoid;break-inside:avoid}",
  "th,td{border:1px solid #b9c4c0;padding:4px 5px;text-align:left;vertical-align:top}thead th{background:#eef2f0;font-size:10px}",
  "th small,td small{display:block;font-weight:normal;color:#4a5a56;font-size:9px}td span{display:block;font-size:10px}",
  ".grid td{text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact}",
  ".lv-red{background:#fde4e2}.lv-yellow{background:#fdf3d0}.lv-blue{background:#e0ecfb}.lv-green{background:#dff3e4}.none{color:#6b7a76;background:#f4f5f4}",
  ".avg{background:#fafbfa}.note{color:#4a5a56;font-size:10px;margin:4px 0}",
  ".errors ul{margin:0;padding-left:18px;columns:2}.std{break-inside:avoid;page-break-inside:avoid}.headline{margin:0 0 4px}",
  ".notes p{white-space:pre-wrap}",
  "footer{margin-top:14px;padding-top:6px;border-top:1px solid #b9c4c0;font-size:9px;color:#4a5a56}",
].join("");
