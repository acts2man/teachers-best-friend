/**
 * The school year and a test's "date given" (27 Oct 2026). The class super
 * grid (docs/design/super-grids.md) reads only the current school year, and
 * splits it by date given (the last 30 days, and before), so both are
 * recorded -- nothing older is deleted or hidden by this.
 *
 * A school year is stored as the year it starts in (2026 = 2026–27) and runs
 * 1 July to 30 June. The teacher picks it at sign-up (the current one unless
 * they change it) and can change it in Settings.
 *
 * A test's date given is a calendar day, "YYYY-MM-DD", in the teacher's own
 * time zone. It is set to the day the class set is graded (unless the teacher
 * set one already) and the teacher can edit it on the test. A test from before
 * this has none: dateGivenOf reads the day it was created instead.
 */
import type { Assessment, Workspace } from "./teacher-types";

/** The school year a day falls in: July onward is the year starting then. */
export function schoolYearOf(day: Date): number {
  return day.getMonth() >= 6 ? day.getFullYear() : day.getFullYear() - 1;
}

export function currentSchoolYear(now: Date = new Date()): number {
  return schoolYearOf(now);
}

/** "2026–27". */
export function schoolYearLabel(year: number): string {
  return year + "–" + String((year + 1) % 100).padStart(2, "0");
}

/** A usable stored school year (a whole year in a sane range), or null. */
export function validSchoolYear(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 2000 && value <= 2100 ? value : null;
}

/** The years a teacher may pick: last year, this one and the next. */
export function schoolYearOptions(now: Date = new Date()): number[] {
  const y = currentSchoolYear(now);
  return [y - 1, y, y + 1];
}

/** The teacher's school year: the one they chose, or the current one. */
export function teacherSchoolYear(w: Pick<Workspace, "settings">, now: Date = new Date()): number {
  return validSchoolYear(w.settings.schoolYear) ?? currentSchoolYear(now);
}

/** A day as "YYYY-MM-DD" in this device's time zone. */
export function localDateString(day: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return day.getFullYear() + "-" + p(day.getMonth() + 1) + "-" + p(day.getDate());
}

/** Whether a string is a real calendar day "YYYY-MM-DD" (2026-02-31 is not). */
export function isDateString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const day = new Date(y, m - 1, d);
  return day.getFullYear() === y && day.getMonth() === m - 1 && day.getDate() === d;
}

/** A test with its date given set to `today` -- the day its work is graded
 * -- unless it has one already (the class set and one student at a time
 * alike). */
export function withDateGiven<T extends Pick<Assessment, "dateGiven">>(a: T, today: string = localDateString()): T {
  return isDateString(a.dateGiven) ? a : { ...a, dateGiven: today };
}

/** A "YYYY-MM-DD" day as a local Date (midnight). */
export function dayOf(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The day a test was given: its date given, or (a test from before dates
 * were recorded) the day it was created. */
export function dateGivenOf(a: Pick<Assessment, "dateGiven" | "createdAt">): string {
  if (isDateString(a.dateGiven)) return a.dateGiven;
  const created = new Date(a.createdAt);
  return Number.isNaN(created.getTime()) ? localDateString() : localDateString(created);
}

/** Whether a test was given in a school year. */
export function givenInSchoolYear(a: Pick<Assessment, "dateGiven" | "createdAt">, year: number): boolean {
  return schoolYearOf(dayOf(dateGivenOf(a))) === year;
}

/** Whole days from a test's date given to `now` (0 = today). */
export function daysSinceGiven(a: Pick<Assessment, "dateGiven" | "createdAt">, now: Date = new Date()): number {
  const today = dayOf(localDateString(now));
  return Math.round((today.getTime() - dayOf(dateGivenOf(a)).getTime()) / 86400000);
}
