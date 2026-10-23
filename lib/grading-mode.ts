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
 * This file is the mode itself (G1). Reading scores and levels in 0–4 comes
 * with the grading screens (G2); until then a test in either mode shows
 * percentages.
 */
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
