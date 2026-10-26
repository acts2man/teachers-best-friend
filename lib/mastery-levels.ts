/**
 * The one definition of mastery levels (Ricky's spec, 15 Oct 2026). Every
 * screen, report and recommendation reads its level, colour and cut-offs from
 * here; nothing else may compare a mastery percentage to a number.
 *
 *   Beginning    0–59%   red     Reteach Recommended    Reteach
 *   Approaching  60–79%  yellow  Monitor                Offer targeted practice
 *   Proficient   80–89%  blue    Ready to Move On       Offer optional reinforcement
 *   Exceeding    90–100% green   Extension Recommended  Offer extension activity
 *
 * Every level's next step (Ricky, 19 Oct 2026) opens the same lesson
 * generation with its intent (LessonIntent). Before that only the lowest level
 * (reteach) and Exceeding (extension) had one. Each level also carries its
 * recommendation, shown beside that button. Ricky renamed the lowest level
 * "Beginning" the same day.
 *
 * It replaced a single "mastered at 70%" cut (class analysis) that sat beside
 * 80/65 colour cut-offs and an 80% "Mastered" label elsewhere, so the same
 * student could be "mastered" on one screen and amber on the next.
 *
 * Boundaries are on the percentage rounded to the nearest whole number (Ricky,
 * 19 Oct 2026): Beginning below 59.5, Approaching 59.5 to under 79.5,
 * Proficient 79.5 to under 89.5, Exceeding 89.5 and up. The percentage shown
 * beside a level is that same rounded value (masteryPercent), so 59.5 shows
 * "60%" and is Approaching -- the number on screen and the level always agree.
 * The Beginning line moved from 69.5 to 59.5 on 26 Oct 2026 (Ricky and
 * Michael); the student card's "at or above 70% standard score" count did not
 * move with it -- it has its own line (STANDARD_SCORE_PERCENT).
 * This replaced "true value, rounded down" (#159), under which 69.9 showed
 * 69% and sat in the lowest level.
 */

export type MasteryLevel = "Beginning" | "Approaching" | "Proficient" | "Exceeding";

/** What a generated lesson is for. "reteach" is the lesson the planner has
 * always built. */
export type LessonIntent = "reteach" | "practice" | "reinforcement" | "extension";
export const LESSON_INTENTS = ["reteach", "practice", "reinforcement", "extension"] as const;

export type MasteryLevelInfo = {
  level: MasteryLevel;
  /** Lowest percentage in the level (inclusive). */
  min: number;
  /** The range as a teacher reads it. */
  range: string;
  /** Colour name; the CSS classes are `level-<tone>`. */
  tone: "red" | "yellow" | "blue" | "green";
  /** Who the reteach groups and extension lists hold: Beginning students are
   * the ones the app reteaches, Exceeding the ones it extends. */
  recommendation: "reteach" | "extend" | null;
  /** The next step for a student at this level: the button's label and the
   * lesson it opens. */
  nextStep: { label: string; intent: LessonIntent };
  /** The recommendation shown beside the next-step button (Ricky, 19 Oct
   * 2026). */
  advice: string;
  /** One line for a teacher. */
  description: string;
};

export const MASTERY_LEVELS: readonly MasteryLevelInfo[] = [
  { level: "Beginning", min: 0, range: "0–59%", tone: "red", recommendation: "reteach", nextStep: { label: "Reteach", intent: "reteach" }, advice: "Reteach Recommended", description: "Reteach and support" },
  { level: "Approaching", min: 60, range: "60–79%", tone: "yellow", recommendation: null, nextStep: { label: "Offer targeted practice", intent: "practice" }, advice: "Monitor", description: "Close to the standard: targeted practice" },
  { level: "Proficient", min: 80, range: "80–89%", tone: "blue", recommendation: null, nextStep: { label: "Offer optional reinforcement", intent: "reinforcement" }, advice: "Ready to Move On", description: "Meeting the standard: optional reinforcement" },
  { level: "Exceeding", min: 90, range: "90–100%", tone: "green", recommendation: "extend", nextStep: { label: "Offer extension activity", intent: "extension" }, advice: "Extension Recommended", description: "Ready for advanced application and extension" },
];

/** The level for a mastery percentage (0–100), on the percentage rounded to
 * the nearest whole number -- the one shown beside it. */
export function masteryLevel(percent: number): MasteryLevelInfo {
  const shown = masteryPercent(percent);
  let found = MASTERY_LEVELS[0];
  for (const l of MASTERY_LEVELS) if (shown >= l.min) found = l;
  return found;
}

/** The level for a percentage that may be missing. */
export function masteryLevelOf(percent: number | null | undefined): MasteryLevelInfo | null {
  return percent === null || percent === undefined || !Number.isFinite(percent) ? null : masteryLevel(percent);
}

/** A mastery percentage for display, rounded to the nearest whole number
 * (59.5 shows as 60). The level is read from this same number. */
export function masteryPercent(percent: number): number {
  // A hair of tolerance so a half that arithmetic left a hair short
  // (69.49999…) still rounds up, as the teacher would round it by hand.
  return Math.round(percent + 1e-9);
}

/** Beginning: the level the app recommends reteaching for. */
export function needsReteach(percent: number | null | undefined): boolean {
  return masteryLevelOf(percent)?.recommendation === "reteach";
}

/** Exceeding: the level the app recommends extension for. */
export function readyToExtend(percent: number | null | undefined): boolean {
  return masteryLevelOf(percent)?.recommendation === "extend";
}

/** The CSS class for a level's colour, or the "no score" class. */
export function levelClass(percent: number | null | undefined): string {
  const l = masteryLevelOf(percent);
  return l ? "level-" + l.tone : "level-none";
}

/** Whether a student is Exceeding on every standard they have a level on (at
 * least one): who the app suggests extension for across standards. Standards
 * with no level yet do not hold them back -- a catalog standard never assessed
 * kept every student out of enrichment (review of this PR). */
export function exceedingOnAllAssessed(statuses: string[]): boolean {
  const levels = statuses.filter((s) => MASTERY_LEVELS.some((l) => l.level === s));
  return levels.length > 0 && levels.every((s) => s === "Exceeding");
}

/** The student card's "skills at or above 70% standard score" line (Ricky, 15
 * Oct 2026). Its own number, not the level table's: when the Beginning line
 * moved to 59.5, the card kept counting skills at 70% and above. */
export const STANDARD_SCORE_PERCENT = 70;

/** The plain-language rule, for method notes and reports. */
export const MASTERY_LEVELS_NOTE =
  "Levels: Beginning 0–59% (reteach), Approaching 60–79% (targeted practice), Proficient 80–89% (optional reinforcement), Exceeding 90–100% (extension), on the percentage rounded to the nearest whole number.";

/** The intent a lesson link asked for, or "reteach" for anything else. */
export function lessonIntent(raw: string | null | undefined): LessonIntent {
  return (LESSON_INTENTS as readonly string[]).includes(raw ?? "") ? (raw as LessonIntent) : "reteach";
}
