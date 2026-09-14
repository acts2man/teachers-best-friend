import { getPipeline, getCostBreakdown } from "@/lib/supabase-admin";
import { setPipelineStage } from "@/app/admin/actions";
import { fmtUsd, fmtRel, fmtCents, fmtInt, modelLabel } from "@/components/admin/format";

/* Each kind of work the AI does, in the order a teacher meets it. The
   internal stage id is what pipeline_config stores; everything else here is
   the plain-language explanation shown to admins. */
const STAGE_GUIDE: { id: string; label: string; runs: string; often: string }[] = [
  { id: "assignment", label: "Assignment read",        runs: "When a teacher uploads a worksheet. Reads the questions and matches each one to a standard.", often: "Once per assignment" },
  { id: "answer_key", label: "Answer key read",        runs: "When a teacher uploads or pastes the answer key for that worksheet.", often: "Once per assignment" },
  { id: "responses",  label: "Student worksheet scan", runs: "When a teacher scans a student's completed worksheet. Reads the answers and checks them against the key.", often: "Once per student, per assignment. This is where nearly all the volume is." },
  { id: "lesson",     label: "Lesson plan",            runs: "When a teacher asks for a reteaching lesson on a standard.", often: "Only when a teacher asks" },
  { id: "reteaching", label: "Reteaching material",    runs: "When students share a misconception and the reteaching library has nothing for it yet.", often: "Only on a library miss; falls toward zero as the library fills" },
  { id: "catalog",    label: "Standards lookup",       runs: "When a grade's official standards are loaded for the first time. The result is shared with every teacher.", often: "Once per state, grade, and subject, ever" },
  { id: "roster",     label: "Roster read",            runs: "When a teacher photographs a class roster to add students.", often: "Once per class" },
  { id: "support",    label: "Support reply",          runs: "When a teacher opens a help ticket; drafts the first answer.", often: "Once per ticket" },
];
const UNUSED = new Set(["embedding"]);
const EFFORTS: { v: string; label: string }[] = [
  { v: "none", label: "None" },
  { v: "minimal", label: "Minimal (Luna rejects this)" },
  { v: "low", label: "Low (recommended)" },
  { v: "medium", label: "Medium" },
  { v: "high", label: "High" },
];

export default async function PipelinePage() {
  const [{ stages, models }, breakdown] = await Promise.all([getPipeline(), getCostBreakdown()]);
  const byStage = new Map<string, { calls: number; completed: number; failed: number; cost: number }>();
  for (const r of breakdown) {
    const b = byStage.get(r.stage) ?? { calls: 0, completed: 0, failed: 0, cost: 0 };
    b.calls += Number(r.calls); b.completed += Number(r.completed); b.failed += Number(r.failed); b.cost += Number(r.cost_usd);
    byStage.set(r.stage, b);
  }
  const configOf = new Map(stages.map((s) => [s.stage, s]));
  const priceOf = new Map(models.map((m) => [m.model, m]));
  const rows = STAGE_GUIDE.filter((g) => configOf.has(g.id));
  const extra = stages.filter((s) => !STAGE_GUIDE.some((g) => g.id === s.stage) && !UNUSED.has(s.stage));
  const unused = stages.filter((s) => UNUSED.has(s.stage));

  return (
    <>
      <h1>AI pipeline</h1>
      <p className="ad-sub">Which AI model handles each kind of work, and how much thinking it is allowed. Changes take effect on the next request, no deploy, and every change is recorded in the audit log.</p>

      <div className="ad-grid two" style={{ marginBottom: "16px" }}>
        <section className="panel ad-panel">
          <div className="ad-panel-head"><div className="ad-panel-title"><h2>What the three settings mean</h2></div></div>
          <dl className="ad-glossary">
            <div><dt>Model</dt><dd>Which AI does the work. The price after each name is what it charges per million words in and per million words out. Luna is the cheap workhorse; Sol is the strongest and the most expensive.</dd></div>
            <div><dt>Reasoning</dt><dd>How much the AI is allowed to think before it answers. More thinking gives better judgement on hard material but is slower and costs more, because thinking is billed like output. “Low” is right for reading and checking work.</dd></div>
            <div><dt>Max answer length</dt><dd>A ceiling on how long the AI’s reply may be, in tokens (about three quarters of a word each, so 3,000 ≈ 2,000 words). It is a safety cap, not a target: the AI only uses what it needs. Set it too low and a long worksheet gets cut off and the scan fails.</dd></div>
          </dl>
        </section>
        <section className="panel ad-panel">
          <div className="ad-panel-head"><div className="ad-panel-title"><h2>Where the money goes</h2></div></div>
          <p style={{ margin: 0, maxWidth: "60ch" }}>
            <strong>Student worksheet scan</strong> runs once for every student on every assignment, so it is almost all of the volume: keep it on the cheapest model that reads handwriting well. <strong>Assignment read</strong> and <strong>answer key read</strong> run once per assignment, so a better model there costs almost nothing. <strong>Standards lookup</strong> runs once per grade, ever, and is then shared with everyone. The rest only run when a teacher asks. The “This month” column shows what actually happened; the Usage page has the full breakdown.
          </p>
        </section>
      </div>

      <div className="panel ad-panel">
        <div className="ad-panel-head">
          <div className="ad-panel-title"><h2>Kinds of work</h2><span className="ad-count">{rows.length}</span></div>
          <span className="ad-meta">this month’s figures from the scans table</span>
        </div>
        <div className="ad-table-wrap">
          <table>
            <thead><tr><th className="pipe-work">Kind of work</th><th className="pipe-model">Model</th><th className="pipe-effort">Reasoning</th><th className="pipe-max">Max answer length</th><th className="num">This month</th><th aria-hidden="true"></th></tr></thead>
            <tbody>
              {[...rows.map((g) => ({ g, s: configOf.get(g.id)! })), ...extra.map((s) => ({ g: { id: s.stage, label: s.stage, runs: s.notes ?? "", often: "" }, s }))].map(({ g, s }) => {
                const formId = `stage-${g.id}`;
                const actual = byStage.get(g.id);
                const avg = actual && actual.completed ? actual.cost / actual.completed : 0;
                return (
                  <tr key={g.id}>
                    <td className="pipe-work">
                      <form id={formId} action={setPipelineStage}><input type="hidden" name="stage" value={g.id} /></form>
                      <strong>{g.label}</strong>
                      <div className="muted" style={{ fontSize: ".8rem", marginTop: "2px" }}>{g.runs}</div>
                      {g.often && <div style={{ fontSize: ".76rem", marginTop: "4px", color: "var(--ad-green-deep)", fontWeight: 600 }}>{g.often}</div>}
                      <div className="muted" style={{ fontSize: ".72rem", marginTop: "4px" }}>changed {fmtRel(s.updated_at)}</div>
                    </td>
                    <td>
                      <select name="model" form={formId} defaultValue={s.model} aria-label={`Model for ${g.label}`} style={{ width: "100%" }}>
                        {models.map((m) => <option key={m.model} value={m.model}>{modelLabel(m.model)}</option>)}
                      </select>
                      {priceOf.get(s.model) && (
                        <div className="muted" style={{ fontSize: ".72rem", marginTop: "3px" }}>
                          {fmtUsd(priceOf.get(s.model)!.input_per_mtok, 2)} in · {fmtUsd(priceOf.get(s.model)!.output_per_mtok, 2)} out, per million tokens
                        </div>
                      )}
                    </td>
                    <td>
                      <select name="reasoning_effort" form={formId} defaultValue={s.reasoning_effort} aria-label={`Reasoning for ${g.label}`} style={{ width: "100%" }}>
                        {EFFORTS.map((e) => <option key={e.v} value={e.v}>{e.label}</option>)}
                      </select>
                    </td>
                    <td>
                      <input name="max_output_tokens" form={formId} type="number" min={100} max={32000} step={100} defaultValue={s.max_output_tokens} style={{ width: "7rem" }} aria-label={`Max answer length for ${g.label}`} />
                      <div className="muted" style={{ fontSize: ".72rem", marginTop: "3px" }}>≈ {fmtInt(Math.round(s.max_output_tokens * 0.75))} words</div>
                    </td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      {actual && actual.calls > 0 ? (
                        <>
                          <div>{fmtInt(actual.calls)} call{actual.calls === 1 ? "" : "s"}</div>
                          <div className="muted" style={{ fontSize: ".78rem" }} title={`exact: ${fmtUsd(avg, 4)}`}>{avg ? `${fmtCents(avg)} each` : ""}{actual.failed ? ` · ${actual.failed} failed` : ""}</div>
                        </>
                      ) : <span className="muted">no calls yet</span>}
                    </td>
                    <td className="num"><button className="btn btn-quiet btn-sm" form={formId}>Save</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {unused.length > 0 && (
          <p className="muted" style={{ fontSize: ".8rem", marginTop: "12px", marginBottom: 0 }}>
            Not shown: {unused.map((s) => `“${s.stage}”`).join(", ")} — a placeholder row the app does not call. Standards matching by meaning, when it is switched on, uses a separate embedding model billed on its own.
          </p>
        )}
      </div>
    </>
  );
}
