/**
 * The one definition of mastery levels (Ricky's spec, 15 Oct 2026). Every
 * screen, report and recommendation reads its level, colour and cut-offs from
 * here; nothing else may compare a mastery percentage to a number.
 *
 *   Developing   0–69%   red     reteach and support
 *   Approaching  70–79%  yellow  no recommendation
 *   Proficient   80–89%  blue    no recommendation
 *   Exceeding    90–100% green   advanced application / extension
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

export type MasteryLevelInfo = {
  level: MasteryLevel;
  /** Lowest percentage in the level (inclusive). */
  min: number;
  /** The range as a teacher reads it. */
  range: string;
  /** Colour name; the CSS classes are `level-<tone>`. */
  tone: "red" | "yellow" | "blue" | "green";
  /** What the app suggests for a student at this level, or nothing. */
  recommendation: "reteach" | "extend" | null;
  /** One line for a teacher. */
  description: string;
};

export const MASTERY_LEVELS: readonly MasteryLevelInfo[] = [
  { level: "Developing", min: 0, range: "0–69%", tone: "red", recommendation: "reteach", description: "Reteach and support" },
  { level: "Approaching", min: 70, range: "70–79%", tone: "yellow", recommendation: null, description: "Close to the standard" },
  { level: "Proficient", min: 80, range: "80–89%", tone: "blue", recommendation: null, description: "Meeting the standard" },
  { level: "Exceeding", min: 90, range: "90–100%", tone: "green", recommendation: "extend", description: "Ready for advanced application and extension" },
];

/** The level for a mastery percentage (0–100), on its true value. */
export function masteryLevel(percent: number): MasteryLevelInfo {
  let found = MASTERY_LEVELS[0];
  for (const l of MASTERY_LEVELS) if (percent >= l.min) found = l;
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

/** The plain-language rule, for method notes and reports. */
export const MASTERY_LEVELS_NOTE =
  "Levels: Developing 0–69% (reteach and support), Approaching 70–79%, Proficient 80–89%, Exceeding 90–100% (extension).";
