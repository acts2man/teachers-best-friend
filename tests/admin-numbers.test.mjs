// The admin numbers agree, and teaching cost is kept apart from admin cost.
//
// The two bugs, from Troy's screenshots:
//   1. Accounts (the page ledger) and Usage & cost (the raw scan log) showed
//      different "Scans" for the same teacher and period. They count different
//      things -- billed pages (the meter) vs billable AI calls -- so the fix
//      labels each and surfaces the meter number on both pages from one source.
//   2. Usage & cost folded admin/library work into a teacher's cost: troy@ read
//      $0.57 over 3 scans, but $0.46 was four admin catalog loads (billable =
//      false). The per-scan figure divided the small cost while the cost column
//      showed the large one, so the margin was wrong for any account that ever
//      did admin work.
//
// The JS harness has no database, so this proves the arithmetic contract
// against a mixed fixture AND asserts the SQL view (teacher_unit_economics)
// actually implements it. If the migration stops splitting the cost, or the
// margin goes back to subtracting total cost, the structural half fails.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

// A pure reproduction of the view's per-teacher-month aggregation, so the
// fixture's expected numbers are computed the same way the SQL computes them.
function unitEconomics(scans, ledgerPages, planPriceUsd) {
  const complete = (s) => s.billable && s.status === "complete";
  const teaching = scans.filter(complete);
  const round = (n, d) => Number(n.toFixed(d));
  const teachingCost = teaching.reduce((a, s) => a + s.cost_usd, 0);
  const adminCost = scans.filter((s) => !s.billable).reduce((a, s) => a + s.cost_usd, 0);
  const total = scans.reduce((a, s) => a + s.cost_usd, 0);
  return {
    scans: teaching.length, // billable, completed AI calls
    pages_billed: ledgerPages, // the ledger meter (same source as Accounts)
    teaching_cost_usd: round(teachingCost, 4),
    admin_cost_usd: round(adminCost, 4),
    ai_cost_usd: round(total, 4), // the true total; money still reconciles
    avg_cost_per_scan: teaching.length ? round(teachingCost / teaching.length, 6) : 0,
    gross_margin_usd: round(planPriceUsd - teachingCost, 4),
  };
}

test("teaching cost, admin cost and margin are computed the way troy@'s row needs", () => {
  // troy@ from the screenshot: teaching scans about $0.10, four admin catalog
  // loads (billable = false) about $0.46, ~$0.57 total. The screenshot's three
  // figures are rounded and do not sum exactly; the fixture uses internally
  // consistent numbers of the same shape (teaching $0.10, admin $0.47, total
  // $0.57) plus a failed teaching scan that cost $0.
  const scans = [
    { billable: true, status: "complete", cost_usd: 0.04 },
    { billable: true, status: "complete", cost_usd: 0.03 },
    { billable: true, status: "complete", cost_usd: 0.03 },
    { billable: false, status: "complete", cost_usd: 0.12 },
    { billable: false, status: "complete", cost_usd: 0.12 },
    { billable: false, status: "complete", cost_usd: 0.12 },
    { billable: false, status: "complete", cost_usd: 0.11 },
    { billable: true, status: "failed", cost_usd: 0 },
  ];
  const planPrice = 9.0; // a paid plan, where margin matters
  const r = unitEconomics(scans, 3, planPrice);

  assert.equal(r.scans, 3, "three billable, completed AI calls");
  assert.equal(r.teaching_cost_usd, 0.1, "teaching cost is the teacher's own scans");
  assert.equal(r.admin_cost_usd, 0.47, "admin/library cost is separated out");
  assert.equal(r.ai_cost_usd, 0.57, "the total still adds up to every cent spent");

  // The per-scan figure and the cost it is paired with now describe the same
  // rows: per-scan × scans ≈ teaching cost, not total.
  // (per-scan is rounded to 6 dp, so allow a rounding cent, not exact equality)
  assert.ok(Math.abs(r.avg_cost_per_scan * r.scans - r.teaching_cost_usd) < 1e-3);

  // The margin uses teaching cost, not total. This is the bug: it must NOT be
  // price − 0.57.
  assert.equal(r.gross_margin_usd, 8.9, "margin = price − teaching cost");
  assert.notEqual(r.gross_margin_usd, Number((planPrice - r.ai_cost_usd).toFixed(4)));
});

test("the two pages agree on the meter: Billed is the ledger count on both", () => {
  // Accounts shows current_period_scan_count (the ledger). Unit economics now
  // carries pages_billed from the same page_charges. With no billed pages the
  // meter is 0 on both even while AI calls is non-zero -- which is the honest
  // story of an uncounted-scan month, not a contradiction.
  const scans = [
    { billable: true, status: "complete", cost_usd: 0.02 },
    { billable: true, status: "complete", cost_usd: 0.02 },
  ];
  const withLedger = unitEconomics(scans, 2, 0);
  assert.equal(withLedger.pages_billed, 2, "meter reflects the ledger");
  assert.equal(withLedger.scans, 2, "AI calls is its own, separately-labelled number");

  const noLedger = unitEconomics(scans, 0, 0);
  assert.equal(noLedger.pages_billed, 0, "0 billed while 2 AI calls is the true state, not a bug");
  assert.equal(noLedger.scans, 2);
});

test("the teacher_unit_economics view implements the split and the corrected margin", () => {
  const sql = fs.readFileSync(
    path.join(ROOT, "supabase/migrations/20260923171000_admin_numbers_agree_and_split_teaching_from_admin_cost.sql"),
    "utf8",
  );
  // Teaching cost: billable + complete.
  assert.ok(
    /teaching_cost_usd[\s\S]*?filter \(where s\.billable and s\.status = 'complete'\)/.test(sql),
    "teaching cost must filter billable + complete",
  );
  // Admin cost: billed to nobody.
  assert.ok(
    /admin_cost_usd[\s\S]*?filter \(where not s\.billable\)/.test(sql),
    "admin cost must filter not billable",
  );
  // The meter, from the ledger, so both pages can agree.
  assert.ok(/pages_billed/.test(sql) && /from public\.page_charges/.test(sql), "pages_billed comes from the ledger");
  // Margin uses teaching cost, never total.
  assert.ok(
    /price_cents \/ 100\.0 - sa\.teaching_cost_usd/.test(sql),
    "margin must subtract teaching cost, not total ai_cost",
  );
});
