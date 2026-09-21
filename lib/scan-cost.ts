/**
 * What a teacher is told a stack will cost, before they commit to it.
 *
 * Pure, and tested, because this is the sentence that has to be true. A
 * teacher who presses Grade after reading "uses 30 scans" and finds 30 gone is
 * fine; a teacher who reads it and finds 60 gone has been lied to by their own
 * software, and there is no version of that they should have to discover from
 * the meter afterwards.
 */

export type StackCost = {
  /** Pages in the stack, counting a multi-page PDF as its real page count. */
  pages: number;
  /** Pages that will be charged: the ones not already paid for. */
  charge: number;
};

/**
 * Adds up a stack. `paidPages` is however many of them the ledger has already
 * charged for -- a re-grade of work scanned this morning charges nothing.
 */
export function stackCost(pageCounts: number[], paidPages = 0): StackCost {
  const pages = pageCounts.reduce((sum, n) => sum + (n > 0 ? n : 1), 0);
  return { pages, charge: Math.max(pages - paidPages, 0) };
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The grade button's label.
 *
 * It states the charge even when the charge is zero, because "uses 0 scans" is
 * the answer to the question a teacher actually has when they re-grade a stack
 * they have already paid for.
 */
export function gradeButtonLabel(cost: StackCost): string {
  if (cost.pages === 0) return "Grade";
  return `Grade ${plural(cost.pages, "page")} · uses ${plural(cost.charge, "scan")}`;
}

/** What a teacher is told when a stack does not fit what they have left. */
export function overQuotaMessage(pages: number, remaining: number): string {
  return remaining === 0
    ? `This class set is ${plural(pages, "page")}. You have no scans left this period.`
    : `This class set is ${plural(pages, "page")}. You have ${plural(remaining, "scan")} left.`;
}
