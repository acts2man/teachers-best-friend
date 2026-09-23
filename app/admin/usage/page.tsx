import Link from "next/link";
import { Coins, ScanLine, Target, Gauge, CalendarRange } from "lucide-react";
import { getDailyUsage, getModelCosts, getPlatformStats, getCostBreakdown, supabaseAdmin, type UnitEconomicsRow } from "@/lib/supabase-admin";
import { UsageChart } from "@/components/admin/usage-chart";
import { Kpi } from "@/components/admin/kpi";
import { fmtUsd, fmtInt, fmtCents, fmtPerScan, stageInfo, modelLabel } from "@/components/admin/format";

/* The number the business is managed to. */
const TARGET_COST_PER_SCAN = 0.01;

function CentsPill({ value }: { value: number }) {
  const tone = value > TARGET_COST_PER_SCAN * 2 ? "bad" : value > TARGET_COST_PER_SCAN ? "warn" : "good";
  return <span className={`kpi-delta ${tone}`} title={`exact: ${fmtUsd(value, 4)}`}>{fmtPerScan(value)}</span>;
}

export default async function UsagePage() {
  const [daily, models, stats, breakdown] = await Promise.all([getDailyUsage(), getModelCosts(), getPlatformStats(), getCostBreakdown()]);
  const { data: econ } = await supabaseAdmin().from("teacher_unit_economics").select("*").order("period", { ascending: false }).limit(200);
  const { data: emails } = await supabaseAdmin().from("admin_accounts").select("teacher_id,email");
  const emailOf = new Map((emails ?? []).map((e) => [e.teacher_id, e.email]));

  const modelRows = models.map((m) => ({
    ...m,
    cost: (Number(m.input_tokens) / 1e6) * Number(m.input_per_mtok) + (Number(m.output_tokens) / 1e6) * Number(m.output_per_mtok),
  }));
  const totalModelCost = modelRows.reduce((a, m) => a + m.cost, 0);
  const totalCalls = modelRows.reduce((a, m) => a + Number(m.calls), 0);
  // Both averages count real teacher scans only: billable rows that finished.
  // Internal runs (billable = false — today, the catalog stopgap) and failed
  // scans are filtered out in admin_platform_stats, not here.
  const avg = Number(stats.avg_cost_per_scan ?? 0);
  const avg30 = Number(stats.avg_cost_per_scan_30d ?? 0);
  const noteFor = (v: number) => {
    if (v === 0) return undefined;
    const r = v / TARGET_COST_PER_SCAN;
    return r <= 1 ? `At or under the ${fmtPerScan(TARGET_COST_PER_SCAN)} target` : `${r.toFixed(1)}× the ${fmtPerScan(TARGET_COST_PER_SCAN)} target`;
  };
  const toneFor = (v: number) => (v === 0 ? undefined : v <= TARGET_COST_PER_SCAN ? "good" : v <= TARGET_COST_PER_SCAN * 2 ? "warn" : "bad");
  const avgNote = noteFor(avg);
  const avgTone = toneFor(avg);
  const costPerCall = totalCalls ? totalModelCost / totalCalls : 0;
  const scanTrend = daily.slice(-14).map((d) => Number(d.scans));
  const costTrend = daily.slice(-14).map((d) => Number(d.ai_cost));

  // What generated the cost: one row per kind of work and model, summed across teachers.
  const byWork = new Map<string, { stage: string; model: string; calls: number; completed: number; failed: number; cost: number }>();
  for (const r of breakdown) {
    const key = `${r.stage}|${r.model}`;
    const row = byWork.get(key) ?? { stage: r.stage, model: r.model, calls: 0, completed: 0, failed: 0, cost: 0 };
    row.calls += Number(r.calls); row.completed += Number(r.completed); row.failed += Number(r.failed); row.cost += Number(r.cost_usd);
    byWork.set(key, row);
  }
  const workRows = [...byWork.values()].sort((a, b) => b.cost - a.cost);
  const workTotal = workRows.reduce((a, r) => a + r.cost, 0);

  return (
    <>
      <h1>Usage & cost</h1>
      <p className="ad-sub">{fmtInt(stats.scans_this_month)} scans this month · {fmtCents(stats.ai_cost_this_month)} AI cost · {fmtPerScan(avg30)} per scan over the last 30 days</p>

      <section className="kpi-grid" aria-label="Cost per scan">
        <Kpi tier="primary" style={{ ["--i" as string]: 0 }} icon={<Target />} v={fmtPerScan(avg)} l="Average cost per scan (all time)" d={avgNote} tone={avgTone} empty="Awaiting first completed scan" />
        <Kpi tier="primary" style={{ ["--i" as string]: 1 }} icon={<CalendarRange />} v={fmtPerScan(avg30)} l="Average cost per scan (last 30 days)" d={noteFor(avg30)} tone={toneFor(avg30)} empty="No completed scans in the last 30 days" />
        <Kpi style={{ ["--i" as string]: 2 }} icon={<Gauge />} v={fmtPerScan(costPerCall)} l="Average per AI call" d={`${fmtInt(totalCalls)} calls this month`} empty="No AI calls yet" />
        <Kpi style={{ ["--i" as string]: 3 }} icon={<Coins />} v={fmtCents(stats.ai_cost_this_month)} l="AI cost this month" d={`At target: ${fmtCents(TARGET_COST_PER_SCAN * stats.scans_this_month)}`} empty="Awaiting first scan" spark={costTrend} sparkId="usage-cost" />
        <Kpi style={{ ["--i" as string]: 4 }} icon={<ScanLine />} v={stats.scans_this_month} l="Scans this month" d={`${fmtInt(stats.scans_today)} today`} empty="Awaiting first scan" spark={scanTrend} sparkId="usage-scans" />
      </section>

      <p className="muted" style={{ fontSize: ".85rem", margin: "-.25rem 0 0", maxWidth: "80ch" }}>
        Both averages count only real teacher scans that finished: internal runs the app does for itself,
        and scans that failed (which cost nothing), are left out. The <strong>all time</strong> figure still
        carries every scan since launch, including the older, slower model. The <strong>last 30 days</strong>
        figure is the one that says what the app costs to run today. Nothing is deleted — the totals below
        still add up every cent that was spent.
      </p>

      {/* ---------- What generated the cost ---------- */}
      <section className="panel ad-panel ad-section-gap">
        <div className="ad-panel-head">
          <div className="ad-panel-title"><h2>What generated the cost this month</h2><span className="ad-count">{workRows.length} kinds of work</span></div>
          <span className="ad-meta">Averages shown in cents · hover for the exact figure</span>
        </div>
        <p className="muted" style={{ fontSize: ".875rem", margin: "0 0 12px", maxWidth: "72ch" }}>
          Every time the app asks the AI to do something, that is one <strong>call</strong>. A student worksheet scan is one call per student; reading an assignment is one call per assignment; a lesson plan is one call per lesson. Each row shows the kind of work, which model did it, and what it cost on average.
        </p>
        {workRows.length === 0 ? (
          <div className="ad-empty"><ScanLine aria-hidden="true" /><span><strong>Nothing yet this month.</strong> Rows appear as teachers scan.</span></div>
        ) : (
          <div className="ad-table-wrap">
            <table>
              <thead><tr><th>Kind of work</th><th>Model used</th><th className="num">Calls</th><th className="num">Failed</th><th className="num">Average per call</th><th className="num">Total</th><th className="num">Share</th></tr></thead>
              <tbody>
                {workRows.map((r) => {
                  const info = stageInfo(r.stage);
                  const perCall = r.completed ? r.cost / r.completed : r.calls ? r.cost / r.calls : 0;
                  return (
                    <tr key={`${r.stage}|${r.model}`}>
                      <td><strong>{info.label}</strong><div className="muted" style={{ fontSize: ".78rem" }}>{info.what}{info.unit ? ` · ${info.unit}` : ""}</div></td>
                      <td>{modelLabel(r.model)}<div className="mono muted" style={{ fontSize: ".72rem" }}>{r.model}</div></td>
                      <td className="num">{fmtInt(r.calls)}</td>
                      <td className="num">{r.failed ? <span className="pill pill-bad">{r.failed}</span> : <span className="muted">0</span>}</td>
                      <td className="num"><CentsPill value={perCall} /></td>
                      <td className="num" title={`exact: ${fmtUsd(r.cost, 4)}`}>{fmtCents(r.cost)}</td>
                      <td className="num muted">{workTotal ? Math.round((100 * r.cost) / workTotal) : 0}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel ad-panel ad-section-gap">
        <div className="ad-panel-head">
          <div className="ad-panel-title"><h2>Last 90 days</h2><span className="ad-count">{daily.length} days</span></div>
        </div>
        <UsageChart data={daily} />
      </section>

      <div className="ad-grid two ad-section-gap">
        <section className="panel ad-panel">
          <div className="ad-panel-head">
            <div className="ad-panel-title"><h2>Cost by model this month</h2></div>
          </div>
          <div className="ad-table-wrap">
            <table>
              <thead><tr><th>Model</th><th className="num">Calls</th><th className="num">Average per call</th><th className="num">Total</th><th className="num">Share</th></tr></thead>
              <tbody>
                {modelRows.filter((m) => Number(m.calls) > 0).map((m) => (
                  <tr key={m.model}>
                    <td>{modelLabel(m.model)}<div className="mono muted" style={{ fontSize: ".72rem" }}>{m.model} · {fmtInt(m.input_tokens)} in / {fmtInt(m.output_tokens)} out tokens</div></td>
                    <td className="num">{fmtInt(m.calls)}</td>
                    <td className="num"><CentsPill value={m.cost / Number(m.calls)} /></td>
                    <td className="num" title={`exact: ${fmtUsd(m.cost, 4)}`}>{fmtCents(m.cost)}</td>
                    <td className="num muted">{totalModelCost ? Math.round((100 * m.cost) / totalModelCost) : 0}%</td>
                  </tr>
                ))}
                {modelRows.every((m) => Number(m.calls) === 0) && <tr><td colSpan={5} className="muted">No model calls recorded this month. Once the app writes to the scans table, this fills in.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: ".8rem", marginTop: ".75rem" }}>
            If one model dominates and it isn’t Luna, look at <Link href="/admin/pipeline">the pipeline config</Link> — the volume call should be on the cheapest model that passes accuracy.
          </p>
        </section>

        <section className="panel ad-panel">
          <div className="ad-panel-head">
            <div className="ad-panel-title"><h2>Rates in effect</h2></div>
            <span className="ad-meta">price per million tokens</span>
          </div>
          <div className="ad-table-wrap">
            <table>
              <thead><tr><th>Model</th><th className="num">Input</th><th className="num">Cached input</th><th className="num">Output</th></tr></thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.model}><td>{modelLabel(m.model)}<div className="mono muted" style={{ fontSize: ".72rem" }}>{m.model}</div></td><td className="num">{fmtUsd(m.input_per_mtok, 2)}</td><td className="num">{fmtUsd(Number(m.input_per_mtok) * 0.1, 3)}</td><td className="num">{fmtUsd(m.output_per_mtok, 2)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: ".8rem", marginTop: ".75rem" }}>Edit rates in the <code>model_pricing</code> table. Costs on every scan are computed from these at write time.</p>
        </section>
      </div>

      {/* ---------- Unit economics ---------- */}
      <section className="panel ad-panel ad-section-gap">
        <div className="ad-panel-head">
          <div className="ad-panel-title"><h2>What each teacher costs us, month by month</h2><span className="ad-count">{(econ ?? []).length}</span></div>
        </div>
        <p className="muted" style={{ fontSize: ".875rem", margin: "0 0 12px", maxWidth: "78ch" }}>
          For each teacher and month. <strong>Billed</strong> is pages charged against their quota — the same meter they see and the
          same number the <Link href="/admin/accounts">Accounts</Link> page shows. <strong>AI calls</strong> is billable model calls
          that finished, which is what the per-scan cost is figured from. <strong>Teaching</strong> is what those calls cost us;
          <strong> Admin/library</strong> is standards-library work we run for everyone and bill to no one (kept out of the per-scan
          figure and the margin). A free plan always shows a negative margin — that is the cost of the free tier. Click a teacher for
          the full breakdown.
        </p>
        <div className="ad-table-wrap">
          <table>
            <thead><tr><th>Teacher</th><th>Month</th><th>Plan</th><th className="num">They pay</th><th className="num">Billed</th><th className="num">AI calls</th><th className="num">Teaching</th><th className="num">Admin/library</th><th className="num">Per scan</th><th className="num">Lessons reused</th><th className="num">Margin</th></tr></thead>
            <tbody>
              {(econ ?? []).length === 0 && <tr><td colSpan={11} className="muted">No completed scans yet.</td></tr>}
              {(econ ?? []).map((r: UnitEconomicsRow, i: number) => (
                <tr key={i}>
                  <td><Link href={`/admin/accounts/${r.teacher_id}`}>{emailOf.get(r.teacher_id) ?? r.teacher_id.slice(0, 8)}</Link></td>
                  <td className="muted">{new Date(r.period + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}</td>
                  <td>{r.plan_id}</td>
                  <td className="num">{fmtUsd(r.plan_price_usd)}</td>
                  <td className="num" title="pages billed against quota (the teacher's meter)">{r.pages_billed}</td>
                  <td className="num" title="billable model calls that finished">{r.scans}</td>
                  <td className="num" title={`exact: ${fmtUsd(r.teaching_cost_usd, 4)}`}>{fmtCents(r.teaching_cost_usd)}</td>
                  <td className="num" title={`admin/library work billed to nobody — exact: ${fmtUsd(r.admin_cost_usd, 4)}`}>{Number(r.admin_cost_usd) > 0 ? <span className="muted">{fmtCents(r.admin_cost_usd)}</span> : <span className="muted">—</span>}</td>
                  <td className="num"><CentsPill value={Number(r.avg_cost_per_scan)} /></td>
                  <td className="num">{r.cache_hit_rate_pct ?? "—"}{r.cache_hit_rate_pct != null && "%"}</td>
                  <td className="num">{Number(r.gross_margin_usd) < 0 ? <span className="kpi-delta bad">{fmtCents(r.gross_margin_usd)}</span> : <span className="kpi-delta good">{fmtCents(r.gross_margin_usd)}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
