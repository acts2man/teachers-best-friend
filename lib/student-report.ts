/**
 * The printable student report (docs/design/super-grids.md section 4; Ricky,
 * 22 Oct 2026: "something that we can generate a summary report from for
 * teacher, parent conferences" and IEP meetings). Built in the browser from the
 * saved workspace: no AI call, nothing sent anywhere, so printing changes
 * nothing in docs/student-data-flow.md.
 *
 * Privacy (review of #209). The report holds ONLY this student's own figures,
 * plus a class average per cluster -- and that average is shown only where at
 * least MIN_OTHER_ANSWERERS *other* students answered the cluster, so a small
 * class can never let one classmate's score be read off the average. It carries
 * NO teacher-typed free text that could name another student: no test titles,
 * no evidence sources, no stored notes, no custom "Other: ..." error text. Only
 * dates, fixed labels, academic-standard titles from the catalog, and the fixed
 * error-type names (a typed "Other" shows as just "Other"). The one free-text
 * field is a note the teacher types for THIS report, in their own words, if they
 * choose. Laid out to print on one or two Letter or A4 pages.
 */
import { gradingModeName, score4Text } from "./grading-mode";
import { localDateString, schoolYearLabel } from "./school-year";
import { classSuperGrid, clusterAnswererCounts, studentSuperGrid, type Score, type SuperGridCell } from "./super-grid";
import { allStandards } from "./teacher-catalog";
import { evidenceShown, standardHeadline } from "./teacher-workflow";
import type { Classroom, Student, Workspace } from "./teacher-types";

export type ReportSections = { superGrid: boolean; tracker: boolean };

export type StudentReportOptions = {
  /** Standard codes for the Standard Tracker, in the order given. */
  standards: string[];
  /** A note the teacher types for this one report. The only free text on the
   * page; blank by default. Never pulled from stored notes. */
  note?: string;
  /** Both on by default. */
  sections?: Partial<ReportSections>;
  now?: Date;
};

/** At most this many tracker standards fit the one-or-two-page layout. */
export const MAX_TRACKER_STANDARDS = 8;
/** Records shown per tracker standard: the latest ones. */
const TRACKER_ROWS = 6;
/** A class average is shown only with at least this many OTHER answerers, so it
 * cannot reveal one classmate's score (privacy review of #209). */
export const MIN_OTHER_ANSWERERS = 5;

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ESC[c]);

/** A fixed error-type name, with any teacher-typed "Other: ..." detail dropped
 * to just "Other" so no free text reaches the page (privacy review of #209). */
export function fixedErrorName(name: string): string {
  return /^other\b/i.test(name.trim()) ? "Other" : name;
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
  const grid = studentSuperGrid(w, classroom, student.id, now);
  const classRows = new Map(classSuperGrid(w, classroom, now).rows.map((r) => [r.cluster.key, r]));
  // How many OTHER students answered each cluster -- the class average is shown
  // only when that is at least MIN_OTHER_ANSWERERS.
  const answerers = clusterAnswererCounts(w, classroom, now);
  const othersIn = (key: string) => {
    const set = answerers.get(key);
    if (!set) return 0;
    return set.size - (set.has(student.id) ? 1 : 0);
  };
  const catalog = allStandards(w);
  const title = student.name + " · Progress report";
  const parts: string[] = [];

  // The student's own name (this is their report) and class facts only -- never
  // the teacher-typed class name, which could carry another student's name.
  parts.push(
    `<header><h1>${escapeHtml(student.name)}</h1>` +
      `<p>Grade ${escapeHtml(String(classroom.grade))} · ${schoolYearLabel(grid.schoolYear)} school year · as of ${localDateString(now)}</p>` +
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
        const showClass = cls?.level && othersIn(row.cluster.key) >= MIN_OTHER_ANSWERERS;
        parts.push(
          `<tr><th scope="row">${escapeHtml(row.cluster.code ?? row.cluster.name ?? "Other standards")}` +
            (row.cluster.code && row.cluster.name ? `<small>${escapeHtml(row.cluster.name)}</small>` : "") +
            "</th>" +
            row.cells.map(cellHtml).join("") +
            `<td class="avg">${row.overall.level ? escapeHtml(scoreText(row.overall)) + `<span>${escapeHtml(row.overall.level.level)}</span>` : "—"}</td>` +
            `<td class="avg">${showClass && cls?.level ? escapeHtml(scoreText(cls)) + `<span>${escapeHtml(cls.level.level)}</span>` : "—"}</td></tr>`,
        );
      }
      parts.push("</tbody></table>");
      parts.push(
        '<p class="note">Each box: the score on every confirmed answer at that depth of knowledge, its level, and how many questions it rests on. ' +
          `A box on one or two questions is a hint, not a measure. A class average is shown only where at least ${MIN_OTHER_ANSWERERS} other students answered that cluster, and is a single number &mdash; never another student&rsquo;s own result.</p>`,
      );
    }
    if (grid.noDok) parts.push(`<p class="note">${grid.noDok} answered question${grid.noDok === 1 ? " has" : "s have"} no depth-of-knowledge level and ${grid.noDok === 1 ? "is" : "are"} not in the grid.</p>`);
    parts.push("</section>");

    // Error types: the fixed-list names only, a typed "Other: ..." as "Other".
    const errors = new Map<string, number>();
    for (const row of grid.rows) for (const cell of row.cells) for (const e of cell.errorTypes) {
      const name = fixedErrorName(e.name);
      errors.set(name, (errors.get(name) ?? 0) + e.count);
    }
    const common = [...errors].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
    parts.push('<section class="errors"><h2>Common error types</h2>');
    parts.push(
      common.length
        ? "<ul>" + common.map(([name, count]) => `<li><strong>${escapeHtml(name)}</strong> · ${count} answer${count === 1 ? "" : "s"}</li>`).join("") + "</ul>"
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
      // The standard's title is academic-catalog text, not teacher free text.
      parts.push(`<div class="std"><h3>${escapeHtml(code)}${std?.title ? " — " + escapeHtml(std.title) : ""}</h3><p class="headline">${escapeHtml(headline)}</p>`);
      if (records.length) {
        // Date and score only: the source/test name is teacher free text and is
        // left off the page (privacy review of #209).
        parts.push("<table><thead><tr><th>Date</th><th>Score</th></tr></thead><tbody>");
        for (const e of records) {
          const shown = evidenceScore(w, student.id, e);
          parts.push(`<tr><td>${escapeHtml(e.date)}</td><td>${escapeHtml(shown)}</td></tr>`);
        }
        parts.push("</tbody></table>");
      }
      parts.push("</div>");
    }
    parts.push("</section>");
  }

  // The only free text on the page: a note the teacher typed for this report.
  const note = (options.note ?? "").trim();
  if (note) parts.push(`<section class="report-note"><h2>Notes for this report</h2><p>${escapeHtml(note)}</p></section>`);

  parts.push(
    "<footer>A progress summary from classroom tests, made by the teacher with A Teacher&rsquo;s Best Friend. " +
      "It is not an assessment of disability; an IEP team may use it as one input among many.</footer>",
  );

  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${REPORT_CSS}</style></head>` +
    `<body>${parts.join("")}</body></html>`;
  return { title, html };
}

/** One evidence record's score as shown, in the test's own mode (no source). */
function evidenceScore(
  w: Pick<Workspace, "assessments">,
  studentId: string,
  e: Pick<Student["evidence"][number], "score" | "standard" | "assessmentId">,
): string {
  const shown = evidenceShown(w, studentId, e);
  return shown.sbg ? shown.text : shown.percent + "%";
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
  ".report-note p{white-space:pre-wrap}",
  "footer{margin-top:14px;padding-top:6px;border-top:1px solid #b9c4c0;font-size:9px;color:#4a5a56}",
].join("");
