import { getPipeline } from "@/lib/supabase-admin";
import { setPipelineStage } from "@/app/admin/actions";
import { fmtUsd, fmtRel } from "@/components/admin/format";

/* Rough per-call token profile for each stage, from the code audit.
   Used only to project cost on this page — the real number comes from the scans table. */
const PROFILE: Record<string, { input: number; cached: number; output: number; perMonth: number; note: string }> = {
  responses:  { input: 2100, cached: 700,  output: 900,  perMonth: 1200, note: "Once per student per assessment. This is the volume call." },
  assignment: { input: 2500, cached: 1000, output: 2500, perMonth: 8,    note: "Once per assessment. Quality matters more than cost here." },
  answer_key: { input: 1500, cached: 300,  output: 600,  perMonth: 8,    note: "Once per assessment with a key." },
  reteaching: { input: 1200, cached: 2500, output: 1800, perMonth: 40,   note: "Only on a library cache miss. Falls toward zero as the library fills." },
  lesson:     { input: 1500, cached: 500,  output: 1800, perMonth: 10,   note: "Teacher-initiated." },
  catalog:    { input: 800,  cached: 0,    output: 8000, perMonth: 1,    note: "Stopgap for unseeded states. Load real standards instead." },
  roster:     { input: 1500, cached: 100,  output: 400,  perMonth: 1,    note: "Reads names off a roster photo; photo deleted immediately after." },
  support:    { input: 2000, cached: 1500, output: 400,  perMonth: 2,    note: "First-line ticket answering." },
  embedding:  { input: 0,    cached: 0,    output: 0,    perMonth: 0,    note: "Placeholder. Embeddings use text-embedding-3-small, billed separately." },
};

export default async function PipelinePage() {
  const { stages, models } = await getPipeline();
  const priceOf = new Map(models.map((m) => [m.model, m]));

  const cost = (model: string, stage: string) => {
    const p = priceOf.get(model), t = PROFILE[stage];
    if (!p || !t) return 0;
    return (t.input / 1e6) * Number(p.input_per_mtok) + (t.cached / 1e6) * Number(p.cached_input_per_mtok) + (t.output / 1e6) * Number(p.output_per_mtok);
  };
  const monthly = stages.reduce((a, s) => a + cost(s.model, s.stage) * (PROFILE[s.stage]?.perMonth ?? 0), 0);

  return (
    <>
      <h1>AI pipeline</h1>
      <p className="ad-sub">
        Which model runs each stage. Changes take effect on the next request, no deploy.
        Projected cost for a secondary teacher (150 students, 2 assignments/week): <strong>{fmtUsd(monthly, 2)}/month</strong>.
      </p>

      <div className="panel" style={{ padding: ".5rem 0" }}>
        <table>
          <thead><tr><th>Stage</th><th>Model</th><th>Reasoning</th><th className="num">Max output</th><th className="num">Per call</th><th className="num">Calls/mo</th><th className="num">Monthly</th><th></th></tr></thead>
          <tbody>
            {stages.map((s) => {
              const per = cost(s.model, s.stage), t = PROFILE[s.stage];
              const mo = per * (t?.perMonth ?? 0);
              return (
                <tr key={s.stage}>
                  <td>
                    <strong>{s.stage}</strong>
                    <div className="muted" style={{ fontSize: ".78rem", maxWidth: "22rem" }}>{t?.note ?? s.notes}</div>
                    <div className="muted" style={{ fontSize: ".72rem" }}>changed {fmtRel(s.updated_at)}</div>
                  </td>
                  <td colSpan={3}>
                    <form action={setPipelineStage} style={{ display: "flex", gap: ".5rem", alignItems: "center", flexWrap: "wrap" }}>
                      <input type="hidden" name="stage" value={s.stage} />
                      <select name="model" defaultValue={s.model}>
                        {models.map((m) => <option key={m.model} value={m.model}>{m.model} — {fmtUsd(m.input_per_mtok, 2)} / {fmtUsd(m.output_per_mtok, 2)}</option>)}
                      </select>
                      <select name="reasoning_effort" defaultValue={s.reasoning_effort}>
                        {["minimal", "low", "medium", "high"].map((e) => <option key={e} value={e}>{e}</option>)}
                      </select>
                      <input name="max_output_tokens" type="number" min={100} max={32000} step={100} defaultValue={s.max_output_tokens} style={{ width: "6.5rem" }} />
                      <button className="btn btn-quiet btn-sm">Save</button>
                    </form>
                  </td>
                  <td className="num">{fmtUsd(per, 4)}</td>
                  <td className="num">{t?.perMonth ?? "—"}</td>
                  <td className={`num ${mo > 5 ? "kpi-warn" : ""}`}>{fmtUsd(mo, 2)}</td>
                  <td></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="panel" style={{ padding: "1.1rem", marginTop: "1rem" }}>
        <h2 style={{ margin: "0 0 .5rem" }}>How to read this</h2>
        <p style={{ margin: 0, maxWidth: "70ch" }}>
          The <strong>responses</strong> stage fires once per student and dwarfs everything else. Keep it on the cheapest
          model that reads handwriting acceptably, with minimal reasoning. The <strong>assignment</strong> stage fires
          about eight times a month per teacher, so a better model there costs almost nothing. Every change here is
          logged to the audit trail with the previous values. Projections are estimates; the Usage page shows what
          actually happened.
        </p>
      </section>
    </>
  );
}
