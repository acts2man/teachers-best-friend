/**
 * The class super grid (docs/design/super-grids.md, build step 1; Ricky,
 * 22 Oct 2026): every confirmed answer the class has given this school year,
 * across every test, by standard cluster (rows) and Webb DOK (columns). Worked
 * out in the browser from the saved workspace -- no AI call, nothing new sent
 * anywhere.
 *
 * Ricky's "cluster" (7.RP, all of ratios) is what Common Core calls a domain
 * (design 1); clusterOf finds it from the standard's code, or its catalog
 * domain when the code does not say (design 2).
 *
 * A cell pools the class's confirmed answers on the cluster's standards at
 * that DOK, each answer counting once, read in the CLASS's grading mode
 * (lib/grading-mode.ts classGradingMode): a percentage, or a 0–4 average with
 * the 0–4 levels. Both read the same stored credit, so tests graded either way
 * pool. Only students now on the class's roster count (design 6); excluded
 * questions, the AI's unchecked second choice and unconfirmed answers never
 * do; a question with no DOK is left out and counted.
 */
import { ALL_ERROR_TYPES, errorTypeForAi, errorTypesFor } from "./error-types";
import { average4, classGradingMode, type GradingMode } from "./grading-mode";
import { masteryLevel, masteryLevel4, masteryPercent, type MasteryLevelInfo } from "./mastery-levels";
import { daysSinceGiven, givenInSchoolYear, teacherSchoolYear } from "./school-year";
import { isSecondChoice } from "./standard-match";
import { assessmentInClass } from "./teacher-classes";
import { allStandards } from "./teacher-catalog";
import { responseMatch } from "./teacher-metrics";
import type { Assessment, Classroom, Question, Standard, Workspace } from "./teacher-types";

/** A super-grid row: one standard cluster. */
export type Cluster = {
  /** What groups standards into this row: the short code ("7.RP", "A-CED",
   * "RL"), the tidied domain name, or "other". */
  key: string;
  /** The short code, when the standard's code says it. */
  code: string | null;
  /** The domain's name ("Ratios and Proportional Relationships"), or null. */
  name: string | null;
};

const PREFIXES = /^(CCSS\.MATH\.CONTENT\.|CCSS\.ELA-LITERACY\.)/i;
const ELA_STRANDS = new Set(["RL", "RI", "RF", "W", "SL", "L", "RH", "RST", "WHST"]);

/** The short cluster code a standard's code carries, or null (design 2.2). */
export function clusterCode(standardCode: string): string | null {
  const code = standardCode.trim().replace(PREFIXES, "");
  // Florida B.E.S.T. before the generic shapes: MA.7.AR.1.1 is AR; ELA.7.R.1.1 is R.
  let m = /^MA\.(?:K|\d{1,3})\.([A-Z]{1,3})\./.exec(code);
  if (m) return m[1];
  m = /^ELA\.(?:K|\d{1,2})\.([A-Z]{1,2})\./.exec(code);
  if (m) return m[1];
  // High school: A-CED.1, HSA-CED.A.1 -> A-CED.
  m = /^(?:HS)?([NAFGS])-([A-Z]{2,4})\b/.exec(code);
  if (m) return m[1] + "-" + m[2];
  // ELA strands: RL.7.1, RI.4.2 -> RL, RI.
  m = /^([A-Z]{1,4})\.(?:K|\d{1,2})\b/.exec(code);
  if (m && ELA_STRANDS.has(m[1])) return m[1];
  // Grade-level math: 7.RP.1, 4.NBT.B.5, K.CC.3 -> 7.RP, 4.NBT, K.CC.
  m = /^(K|\d{1,2})\.([A-Z]{1,4})\./.exec(code);
  if (m) return m[1] + "." + m[2];
  return null;
}

/** A domain name as compared: case, "&" and "and", and dashes do not matter. */
export function tidyDomain(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The cluster a standard belongs in (design 2): its code's short cluster,
 * else its catalog domain, else "Other standards". */
export function clusterOf(standardCode: string, standard: Pick<Standard, "domain"> | null): Cluster {
  const code = clusterCode(standardCode);
  const name = standard?.domain?.trim() || null;
  if (code) return { key: code, code, name };
  if (name) return { key: "domain:" + tidyDomain(name), code: null, name };
  return { key: "other", code: null, name: null };
}

/** A cluster's label as the screen shows it: "Ratios and Proportional
 * Relationships · 7.RP", the domain alone, the code alone, or "Other standards". */
export function clusterLabel(c: Cluster): string {
  if (c.code && c.name) return c.name + " · " + c.code;
  return c.name ?? c.code ?? "Other standards";
}

/** How one cell (or one standard inside it) scored. */
export type Score = {
  /** Confirmed answers counted. */
  answers: number;
  percent: number | null;
  /** Standards-Based class only: the 0–4 average. */
  score4: number | null;
  level: MasteryLevelInfo | null;
};

export type SuperGridCell = Score & {
  dok: 1 | 2 | 3 | 4;
  /** Questions asked at this DOK on the cluster, this school year. */
  questions: number;
  /** Of them, on tests given in the last 30 days, and before that. */
  recent: number;
  older: number;
  /** Tests those questions came from. */
  tests: number;
  /** The cluster's standards in this cell, weakest first. */
  standards: (Score & { code: string; title: string; questions: number; grade: number; framework: string })[];
  /** The error types tagged on the cell's answers, from each test's fixed
   * list (a typed "Other" label as the teacher wrote it), most common first. */
  errorTypes: { name: string; count: number }[];
};

export type SuperGridRow = { cluster: Cluster; label: string; cells: SuperGridCell[] };

export type SuperGrid = {
  rows: SuperGridRow[];
  mode: GradingMode;
  schoolYear: number;
  /** Tests this school year that the grid read. */
  tests: number;
  /** Questions on those tests with no DOK: not in any cell. */
  noDok: number;
};

const DOKS = [1, 2, 3, 4] as const;
const RECENT_DAYS = 30;

type Answer = { match: number; errorType: string; listed: string[] };
type Asked = { a: Assessment; q: Question; code: string; dok: 1 | 2 | 3 | 4; answers: Answer[] };

function score(matches: number[], mode: GradingMode): Score {
  if (!matches.length) return { answers: 0, percent: null, score4: null, level: null };
  const mean = matches.reduce((x, y) => x + y, 0) / matches.length;
  const s4 = mode === "sbg" ? average4(matches) : null;
  return {
    answers: matches.length,
    percent: masteryPercent(mean),
    score4: s4,
    level: s4 !== null ? masteryLevel4(s4) : masteryLevel(mean),
  };
}

/** Lower is weaker: the 0–4 average in a Standards-Based class, else the percent. */
const weakness = (s: Score) => (s.score4 !== null ? s.score4 * 25 : (s.percent ?? Infinity));

function onList(listed: string[], errorType: string): boolean {
  return listed.includes(errorType) || (listed.includes("Other") && errorType.startsWith("Other: "));
}

/** The class super grid for one class (see the top of this file). */
export function classSuperGrid(
  w: Pick<Workspace, "assessments" | "students" | "customStandards" | "sharedStandards" | "settings">,
  classroom: Pick<Classroom, "id" | "gradingMode">,
  now: Date = new Date(),
): SuperGrid {
  const mode = classGradingMode(w, classroom);
  const schoolYear = teacherSchoolYear(w, now);
  const roster = new Set(w.students.filter((s) => s.classId === classroom.id).map((s) => s.id));
  const catalog = allStandards(w);
  const tests = w.assessments.filter(
    (a) => assessmentInClass(a, classroom.id) && givenInSchoolYear(a, schoolYear) && a.elaArea !== "writing",
  );
  const findStandard = (a: Assessment, code: string) =>
    catalog.find((s) => s.code === code && s.framework === a.framework) ?? catalog.find((s) => s.code === code) ?? null;

  let noDok = 0;
  const asked: (Asked & { cluster: Cluster; title: string })[] = [];
  for (const a of tests) {
    const listed = errorTypesFor(a.subject, a.elaArea);
    for (const q of a.questions) {
      if (q.excluded || !q.standard || (isSecondChoice(q) && !q.verified)) continue;
      const dok = q.dok === 1 || q.dok === 2 || q.dok === 3 || q.dok === 4 ? q.dok : null;
      if (dok === null) {
        noDok++;
        continue;
      }
      const standard = findStandard(a, q.standard);
      const answers = a.responses
        .filter((r) => r.questionId === q.id && r.verified && roster.has(r.studentId))
        .map((r) => ({ match: responseMatch(r), errorType: (r.errorType || "").trim(), listed }));
      asked.push({ a, q, code: q.standard, dok, answers, cluster: clusterOf(q.standard, standard), title: standard?.title ?? "" });
    }
  }

  // Rows in catalog order (where the catalog has the standard), else by code.
  const order = (code: string) => {
    const i = catalog.findIndex((s) => s.code === code);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const byKey = new Map<string, { cluster: Cluster; items: typeof asked; first: number; firstCode: string }>();
  for (const item of asked) {
    const row = byKey.get(item.cluster.key);
    if (row) {
      row.items.push(item);
      if (!row.cluster.name && item.cluster.name) row.cluster = item.cluster;
      if (order(item.code) < row.first) row.first = order(item.code);
    } else byKey.set(item.cluster.key, { cluster: item.cluster, items: [item], first: order(item.code), firstCode: item.code });
  }
  const rows = [...byKey.values()]
    .sort((x, y) =>
      (x.cluster.key === "other" ? 1 : 0) - (y.cluster.key === "other" ? 1 : 0) ||
      x.first - y.first ||
      x.firstCode.localeCompare(y.firstCode),
    )
    .map(({ cluster, items }): SuperGridRow => ({
      cluster,
      label: clusterLabel(cluster),
      cells: DOKS.map((dok): SuperGridCell => {
        const here = items.filter((i) => i.dok === dok);
        const answers = here.flatMap((i) => i.answers);
        const codes = [...new Set(here.map((i) => i.code))];
        const errors = new Map<string, number>();
        for (const ans of answers)
          if (ans.errorType && onList(ans.listed, ans.errorType))
            errors.set(ans.errorType, (errors.get(ans.errorType) ?? 0) + 1);
        const recent = here.filter((i) => daysSinceGiven(i.a, now) <= RECENT_DAYS).length;
        return {
          dok,
          ...score(answers.map((x) => x.match), mode),
          questions: here.length,
          recent,
          older: here.length - recent,
          tests: new Set(here.map((i) => i.a.id)).size,
          standards: codes
            .map((code) => {
              const of = here.filter((i) => i.code === code);
              return {
                code,
                title: of[0].title,
                // The test's, so a lesson finds the standard in its catalog.
                grade: of[0].a.grade,
                framework: of[0].a.framework,
                questions: of.length,
                ...score(of.flatMap((i) => i.answers.map((x) => x.match)), mode),
              };
            })
            .sort((x, y) => weakness(x) - weakness(y) || x.code.localeCompare(y.code)),
          errorTypes: [...errors]
            .map(([name, count]) => ({ name, count }))
            .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name)),
        };
      }),
    }));
  return { rows, mode, schoolYear, tests: tests.length, noDok };
}

/**
 * What a pre-teach lesson planned from a super-grid cell sends to the AI
 * (design step 5; docs/student-data-flow.md section 4): the cluster (its key,
 * which the server turns back into a label from its own catalog), the DOK
 * level, the cell's weakest standards (codes, at most three, weakest first),
 * and its error types as fixed-list names with counts -- a typed "Other: x"
 * only as "Other". No student, no answer, no free text. Null when the cell
 * is not there or has no graded standard. Pure.
 */
export type PreteachFocus = {
  cluster: string;
  label: string;
  dok: 1 | 2 | 3 | 4;
  /** The lesson's standard: the weakest graded one. */
  standard: { code: string; grade: number; framework: string };
  /** The next weakest, codes only. */
  also: string[];
  errorTypes: { name: string; count: number }[];
};

export function preteachFocus(grid: SuperGrid, clusterKey: string, dok: number): PreteachFocus | null {
  const row = grid.rows.find((r) => r.cluster.key === clusterKey);
  const cell = row?.cells.find((c) => c.dok === dok);
  if (!row || !cell) return null;
  const graded = cell.standards.filter((s) => s.level);
  if (!graded.length) return null;
  const counts = new Map<string, number>();
  for (const e of cell.errorTypes) {
    const name = errorTypeForAi(e.name);
    if (ALL_ERROR_TYPES.includes(name)) counts.set(name, (counts.get(name) ?? 0) + e.count);
  }
  return {
    cluster: row.cluster.key,
    label: row.label,
    dok: cell.dok,
    standard: { code: graded[0].code, grade: graded[0].grade, framework: graded[0].framework },
    also: graded.slice(1, 3).map((s) => s.code),
    errorTypes: [...counts]
      .map(([name, count]) => ({ name, count }))
      .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name))
      .slice(0, 10),
  };
}
