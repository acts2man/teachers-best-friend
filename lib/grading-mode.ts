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
 * a 0–4 score is stored in the same `match` (score × 25). So switching a test
 * between modes rewrites no grade and no question's points (setGradingMode),
 * and switching back shows exactly what was there before.
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

/** A test's mode. Anything but "sbg" -- including no mode at all, which is
 * every test made before modes existed -- is Percentage. */
export function gradingModeOf(a: Pick<Assessment, "gradingMode">): GradingMode {
  return a.gradingMode === "sbg" ? "sbg" : "percentage";
}

/** The mode a new test starts in: the one the teacher used last (set when
 * they create a test or switch one), or Percentage. */
export function lastGradingMode(w: Pick<Workspace, "settings">): GradingMode {
  return w.settings.lastGradingMode === "sbg" ? "sbg" : "percentage";
}

/** The test in the given mode, with nothing else changed: no grade, no
 * question points, no evidence. Percentage is stored as no mode at all, so a
 * test switched back is exactly the test it was before. */
export function setGradingMode(a: Assessment, mode: GradingMode): Assessment {
  const rest = { ...a };
  delete rest.gradingMode;
  return mode === "sbg" ? { ...rest, gradingMode: "sbg" } : rest;
}

/** The workspace with one test switched, remembered as the teacher's last
 * mode for their next new test. */
export function switchGradingMode(w: Workspace, assessmentId: string, mode: GradingMode): Workspace {
  return {
    ...w,
    assessments: w.assessments.map((a) => (a.id === assessmentId ? setGradingMode(a, mode) : a)),
    settings: { ...w.settings, lastGradingMode: mode },
  };
}
