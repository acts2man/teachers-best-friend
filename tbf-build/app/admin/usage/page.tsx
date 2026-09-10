import Link from "next/link";
import { getDailyUsage, getModelCosts, getPlatformStats, supabaseAdmin } from "@/lib/supabase-admin";
import { UsageChart } from "@/components/admin/usage-chart";
import { fmtUsd, fmtInt } from "@/components/admin/format";

export default async function UsagePage() {
  const [daily, models, stats] = await Promise.all([getDailyUsage(), getModelCosts(), getPlatformStats()]);
  const { data: econ } = await supabaseAdmin().from("teacher_unit_economics").select("*").order("period", { ascending: false }).limit(200);
  const { data: emails } = await supabaseAdmin().from("admin_accounts").select("teacher_id,email");
  const emailOf = new Map((emails ?? []).map((e) => [e.teacher_id, e.email]));

  const modelRows = models.map((m) => ({
    ...m,
    cost: (Number(m.input_tokens) / 1e6) * Number(m.input_per_mtok) + (Number(m.output_tokens) / 1e6) * Number(m.output_per_mtok),
  }));
  const totalModelCost = modelRows.reduce((a, m) => a + m.cost, 0);

  return (
    <>
      <h1>Usage & cost</h1>
      <p className="ad-sub">{fmtInt(stats.scans_this_month)} scans this month · {fmtUsd(stats.ai_cost_this_month, 2)} AI cost · {fmtUsd(stats.avg_cost_per_scan, 4)} per scan</p>

      <section className="panel" style={{ padding: "1.1rem" }}>
        <h2 style={{ margin: "0 0 .75rem" }}>Last 90 days</h2>
        <UsageChart data={daily} />
      </section>

      <div className="ad-grid two" style={{ marginTop: "1rem" }}>
        <section className="panel" style={{ padding: "1.1rem" }}>
          <h2 style={{ margin: "0 0 .75rem" }}>Cost by model this month</h2>
          <table>
            <thead><tr><th>Model</th><th className="num">Calls</th><th className="num">Input tok</th><th className="num">Output tok</th><th className="num">Cost</th><th className="num">Share</th></tr></thead>
            <tbody>
              {modelRows.filter((m) => Number(m.calls) > 0).map((m) => (
                <tr key={m.model}>
                  <td className="mono">{m.model}</td>
                  <td className="num">{fmtInt(m.calls)}</td>
                  <td className="num">{fmtInt(m.input_tokens)}</td>
                  <td className="num">{fmtInt(m.output_tokens)}</td>
                  <td className="num">{fmtUsd(m.cost, 3)}</td>
                  <td className="num">{totalModelCost ? Math.round((100 * m.cost) / totalModelCost) : 0}%</td>
                </tr>
              ))}
              {modelRows.every((m) => Number(m.calls) === 0) && <tr><td colSpan={6} className="muted">No model calls recorded this month. Once the app writes to the scans table, this fills in.</td></tr>}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: ".8rem", marginTop: ".75rem" }}>
            If one model dominates and it isn't Luna, look at <Link href="/admin/pipeline">the pipeline config</Link> — the volume call should be on the cheapest model that passes accuracy.
          </p>
        </section>

        <section className="panel" style={{ padding: "1.1rem" }}>
          <h2 style={{ margin: "0 0 .75rem" }}>Rates in effect</h2>
          <table>
            <thead><tr><th>Model</th><th className="num">Input /M</th><th className="num">Cached /M</th><th className="num">Output /M</th></tr></thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.model}><td className="mono">{m.model}</td><td className="num">{fmtUsd(m.input_per_mtok, 2)}</td><td className="num">{fmtUsd(Number(m.input_per_mtok) * 0.1, 3)}</td><td className="num">{fmtUsd(m.output_per_mtok, 2)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: ".8rem", marginTop: ".75rem" }}>Edit rates in the <code>model_pricing</code> table. Costs on every scan are computed from these at write time.</p>
        </section>
      </div>

      <section className="panel" style={{ padding: "1.1rem", marginTop: "1rem", overflowX: "auto" }}>
        <h2 style={{ margin: "0 0 .75rem" }}>Unit economics by teacher</h2>
        <table>
          <thead><tr><th>Teacher</th><th>Period</th><th>Plan</th><th className="num">Price</th><th className="num">Scans</th><th className="num">AI cost</th><th className="num">Per scan</th><th className="num">Cache hit</th><th className="num">Margin</th></tr></thead>
          <tbody>
            {(econ ?? []).length === 0 && <tr><td colSpan={9} className="muted">No completed scans yet.</td></tr>}
            {(econ ?? []).map((r: any, i: number) => (
              <tr key={i}>
                <td><Link href={`/admin/accounts/${r.teacher_id}`}>{emailOf.get(r.teacher_id) ?? r.teacher_id.slice(0, 8)}</Link></td>
                <td className="muted">{r.period}</td>
                <td>{r.plan_id}</td>
                <td className="num">{fmtUsd(r.plan_price_usd)}</td>
                <td className="num">{r.scans}</td>
                <td className="num">{fmtUsd(r.ai_cost_usd, 3)}</td>
                <td className="num">{fmtUsd(r.avg_cost_per_scan, 4)}</td>
                <td className="num">{r.cache_hit_rate_pct ?? "—"}{r.cache_hit_rate_pct != null && "%"}</td>
                <td className={`num ${Number(r.gross_margin_usd) < 0 ? "kpi-bad" : ""}`}>{fmtUsd(r.gross_margin_usd, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
