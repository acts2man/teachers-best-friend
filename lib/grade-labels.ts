/**
 * Grade and high-school-math course labels, in one place.
 *
 * K–8 is a plain grade number (0 = Kindergarten). For **Math only**, high
 * school is taught and assessed by course, not by year, so grades 9–12 are
 * replaced with the California Mathematics Framework's traditional pathway,
 * plus Calculus on top:
 *
 *   9  → Algebra 1
 *   10 → Geometry
 *   11 → Algebra 2
 *   12 → Pre-Calculus
 *   13 → Calculus
 *
 * ELA and every other subject keep grades 9–12.
 *
 * Why numeric codes rather than a new string field: `grade` is stored in the
 * database as text but read back through `safe_int`, which turns anything
 * non-numeric into 0, and the client compares grades numerically. Keeping the
 * course as a number (9–13) means it round-trips through storage untouched and
 * — crucially — every Math assessment already saved as grade 9–12 keeps
 * working and simply relabels to its course. Calculus is the one new value
 * (13); it is only ever offered for Math.
 */

export type MathCourse = { grade: number; name: string };

export const MATH_COURSES: MathCourse[] = [
  { grade: 9, name: "Algebra 1" },
  { grade: 10, name: "Geometry" },
  { grade: 11, name: "Algebra 2" },
  { grade: 12, name: "Pre-Calculus" },
  { grade: 13, name: "Calculus" },
];

/** The highest grade value the app accepts — Calculus (Math only). */
export const MAX_GRADE = 13;

/** Whether this (subject, grade) names a high-school Math course. */
export function isMathCourseGrade(
  subject: string | undefined,
  grade: number,
): boolean {
  return subject === "Math" && MATH_COURSES.some((c) => c.grade === grade);
}

/** The course name for a Math course grade (9–13), or null if it isn't one. */
export function mathCourseName(grade: number): string | null {
  return MATH_COURSES.find((c) => c.grade === grade)?.name ?? null;
}

/**
 * How a grade is shown to a teacher. Pass the subject so a Math high-school
 * grade reads as its course ("Algebra 1") rather than "Grade 9". Without a
 * subject — e.g. a classroom, which spans subjects — it stays a grade.
 */
export function gradeLabel(grade: number, subject?: string): string {
  if (subject === "Math") {
    const course = mathCourseName(grade);
    if (course) return course;
  }
  if (grade === 0) return "Kindergarten";
  return "Grade " + grade;
}

/**
 * Options for a grade/course picker, given the chosen subject. K–8 always; then
 * Math shows the five courses (9–13) and every other subject shows grades 9–12.
 */
export function gradeOptions(
  subject: string | undefined,
): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let i = 0; i <= 8; i++)
    options.push({ value: String(i), label: i === 0 ? "Kindergarten" : "Grade " + i });
  if (subject === "Math")
    for (const c of MATH_COURSES) options.push({ value: String(c.grade), label: c.name });
  else for (let i = 9; i <= 12; i++) options.push({ value: String(i), label: "Grade " + i });
  return options;
}

/**
 * Keeps a chosen grade valid when the subject changes: Calculus (13) exists
 * only for Math, so switching a grade-13 selection to another subject drops it
 * to grade 12. Everything else is valid under both.
 */
export function gradeForSubject(grade: number, subject: string | undefined): number {
  if (subject !== "Math" && grade > 12) return 12;
  return grade;
}

/** How a grade is named inside an AI prompt (course for Math HS, else "grade N"/"grade K"). */
export function gradePromptLabel(grade: number, subject: string | undefined): string {
  const course = subject === "Math" ? mathCourseName(grade) : null;
  if (course) return "the " + course + " course";
  return "grade " + (grade === 0 ? "K" : grade);
}
