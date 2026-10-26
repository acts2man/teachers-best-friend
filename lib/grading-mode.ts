/**
 * How a test is graded (docs/design/grading-modes-and-dok-grid.md, section 1):
 *
 *   percentage  every answer is 0–100% credit and the test score is a
 *               points-weighted percentage -- what the app has always done,
 *               and what a test with no mode means.
 *   sbg         Standards-Based Grading: every question is out of 4 and each
 *               answer scores 0–4.
 *
 * The mode is a way of READING a test's grades, never a second copy of them:
 * a 0–4 score is stored in the same `match` (score × 25), and a Standards-Based
 * test's questions keep whatever points they carried -- they are read as 4.
 *
 * The mode is chosen once, when the test is set up (Ricky, 20 Oct 2026); the
 * test page shows it but cannot change it. On a Standards-Based test every
 * question is worth SBG_QUESTION_POINTS, whatever points it carries.
 *
 * This file is the mode itself (G1) and how a Standards-Based test's grades
 * read in 0–4 (G2, 26 Oct 2026): blank is 0, a correct answer is 4, and the
 * teacher picks 0–4 for each group of wrong answers. A student's result, and
 * each standard's, is the average of the 0–4 scores to one decimal, with the
 * 0–4 levels (masteryLevel4).
 */
import { masteryLevel4, score4Shown, type MasteryLevelInfo } from "./mastery-levels";
import type { Assessment, Workspace } from "./teacher-types";

export type GradingMode = "percentage" | "sbg";

export const GRADING_MODES: readonly { mode: GradingMode; label: string; description: string }[] = [
  { mode: "percentage", label: "Percentage", description: "Each answer gets full, part or no credit; the score is a percentage." },
  { mode: "sbg", label: "Standards-Based (0–4)", description: "Every question is out of 4; each answer scores 0, 1, 2, 3 or 4." },
];

/** What every question on a Standards-Based test is worth, always: it cannot
 * be edited (Ricky, 20 Oct 2026). */
export const SBG_QUESTION_POINTS = 4;

/** The mode's name as the test page shows it. */
export function gradingModeLabel(a: Pick<Assessment, "gradingMode">): string {
  return GRADING_MODES.find((m) => m.mode === gradingModeOf(a))!.label;
}

/** A test's mode. Anything but "sbg" -- including no mode at all, which is
 * every test made before modes existed -- is Percentage. */
export function gradingModeOf(a: Pick<Assessment, "gradingMode">): GradingMode {
  return a.gradingMode === "sbg" ? "sbg" : "percentage";
}

/** The mode a new test starts in: the one the teacher used last (set when
 * they create a test), or Percentage. */
export function lastGradingMode(w: Pick<Workspace, "settings">): GradingMode {
  return w.settings.lastGradingMode === "sbg" ? "sbg" : "percentage";
}

/** Whether a test is graded Standards-Based (0–4). */
export function isSbg(a: Pick<Assessment, "gradingMode">): boolean {
  return gradingModeOf(a) === "sbg";
}

/** The five scores a Standards-Based answer can get. */
export const SBG_SCORES = [0, 1, 2, 3, 4] as const;

/** An answer's stored credit (`match`, 0–100) read as 0–4: 25 per point. A
 * credit given in Percentage that is not a quarter (67 = 2 of 3 points) reads
 * as the nearest whole score; `converted` says so, and nothing is written
 * until the teacher picks a score. */
export function score4OfMatch(match: number): { score: number; converted: boolean } {
  const m = Math.max(0, Math.min(100, match));
  const exact = m / 25;
  const score = Math.round(exact);
  return { score, converted: Math.abs(exact - score) > 1e-9 };
}

/** The stored credit for a 0–4 score. */
export function matchOfScore4(score: number): number {
  return Math.max(0, Math.min(4, score)) * 25;
}

/** The average of some answers' credit, as a 0–4 score (unrounded), or null
 * when there are none. Every question on a Standards-Based test counts 4, so
 * this is the plain mean -- no points weighting. */
export function average4(matches: number[]): number | null {
  if (!matches.length) return null;
  return matches.reduce((sum, m) => sum + Math.max(0, Math.min(100, m)), 0) / matches.length / 25;
}

/** A 0–4 average as shown: one decimal, always ("3.0", not "3"). */
export function score4Text(score: number): string {
  return score4Shown(score).toFixed(1);
}

/** A 0–4 average, shown with its level. */
export function score4Result(score: number | null): { text: string; level: MasteryLevelInfo } | null {
  return score === null ? null : { text: score4Text(score), level: masteryLevel4(score) };
}
