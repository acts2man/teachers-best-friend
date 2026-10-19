/**
 * The one definition of mastery levels (Ricky's spec, 15 Oct 2026). Every
 * screen, report and recommendation reads its level, colour and cut-offs from
 * here; nothing else may compare a mastery percentage to a number.
 *
 *   Developing   0–69%   red     Reteach
 *   Approaching  70–79%  yellow  Offer targeted practice
 *   Proficient   80–89%  blue    Offer optional reinforcement
 *   Exceeding    90–100% green   Offer extension activity
 *
 * Every level's next step (Ricky, 19 Oct 2026) opens the same lesson
 * generation with its intent (LessonIntent). Before that only Developing
 * (reteach) and Exceeding (extension) had one.
 *
 * It replaced a single "mastered at 70%" cut (class analysis) that sat beside
 * 80/65 colour cut-offs and an 80% "Mastered" label elsewhere, so the same
 * student could be "mastered" on one screen and amber on the next.
 *
 * Boundaries are on the true value, never a rounded one: 69.9 is Developing,
 * 70 is Approaching, 90 is Exceeding. A percentage shown beside a level is
 * rounded DOWN (masteryPercent), so the number on screen never reads 70% next
 * to "Developing".
 */

export type MasteryLevel = "Developing" | "Approaching" | "Proficient" | "Exceeding";

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
  /** Who the reteach groups and extension lists hold: Developing students are
   * the ones the app reteaches, Exceeding the ones it extends. */
  recommendation: "reteach" | "extend" | null;
  /** The next step for a student at this level: the button's label and the
   * lesson it opens. */
  nextStep: { label: string; intent: LessonIntent };
  /** One line for a teacher. */
  description: string;
};

export const MASTERY_LEVELS: readonly MasteryLevelInfo[] = [
  { level: "Developing", min: 0, range: "0–69%", tone: "red", recommendation: "reteach", nextStep: { label: "Reteach", intent: "reteach" }, description: "Reteach and support" },
  { level: "Approaching", min: 70, range: "70–79%", tone: "yellow", recommendation: null, nextStep: { label: "Offer targeted practice", intent: "practice" }, description: "Close to the standard: targeted practice" },
  { level: "Proficient", min: 80, range: "80–89%", tone: "blue", recommendation: null, nextStep: { label: "Offer optional reinforcement", intent: "reinforcement" }, description: "Meeting the standard: optional reinforcement" },
  { level: "Exceeding", min: 90, range: "90–100%", tone: "green", recommendation: "extend", nextStep: { label: "Offer extension activity", intent: "extension" }, description: "Ready for advanced application and extension" },
];

/** The level for a mastery percentage (0–100), on its true value. */
export function masteryLevel(percent: number): MasteryLevelInfo {
  let found = MASTERY_LEVELS[0];
  // The same hair of tolerance as masteryPercent, so a level and the number
  // shown beside it never disagree (3 × 80 / 3 = 79.99999… is Proficient).
  for (const l of MASTERY_LEVELS) if (percent + 1e-9 >= l.min) found = l;
  return found;
}

/** The level for a percentage that may be missing. */
export function masteryLevelOf(percent: number | null | undefined): MasteryLevelInfo | null {
  return percent === null || percent === undefined || !Number.isFinite(percent) ? null : masteryLevel(percent);
}

/** A mastery percentage for display: rounded down, so it never crosses into
 * the next level (69.9 shows as 69, not 70). */
export function masteryPercent(percent: number): number {
  // A hair of tolerance so 3 × 80 / 3 = 79.99999… still reads 80.
  return Math.floor(percent + 1e-9);
}

/** Developing: the level the app recommends reteaching for. */
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

/** The plain-language rule, for method notes and reports. */
export const MASTERY_LEVELS_NOTE =
  "Levels: Developing 0–69% (reteach), Approaching 70–79% (targeted practice), Proficient 80–89% (optional reinforcement), Exceeding 90–100% (extension).";

/** The intent a lesson link asked for, or "reteach" for anything else. */
export function lessonIntent(raw: string | null | undefined): LessonIntent {
  return (LESSON_INTENTS as readonly string[]).includes(raw ?? "") ? (raw as LessonIntent) : "reteach";
}
