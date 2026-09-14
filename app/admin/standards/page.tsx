import { getStandardsCoverage, getSharedLibrary, supabaseAdmin } from "@/lib/supabase-admin";
import { UnlockStandards } from "@/components/admin/unlock-standards";
import { fmtRel } from "@/components/admin/format";

export default async function StandardsPage() {
  const [cov, shared] = await Promise.all([getStandardsCoverage(), getSharedLibrary()]);
  const sharedTotal = shared.reduce((a, r) => a + r.standards, 0);
  const { count: custom } = await supabaseAdmin().from("standards").select("*", { count: "exact", head: true }).not("teacher_id", "is", null);
  const { data: unlinked } = await supabaseAdmin()
    .from("assessment_questions").select("standard_code").is("standard_id", null).not("standard_code", "is", null).limit(1000);
  const unlinkedCounts = new Map<string, number>();
  (unlinked ?? []).forEach((q) => unlinkedCounts.set(q.standard_code!, (unlinkedCounts.get(q.standard_code!) ?? 0) + 1));
  const topUnlinked = [...unlinkedCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

  const total = cov.reduce((a, c) => a + Number(c.standards), 0);
  const embedded = cov.reduce((a, c) => a + Number(c.embedded), 0);

  return (
    <>
      <h1>Standards</h1>
      <p className="ad-sub">{sharedTotal} shared standards · {embedded} with embeddings · {custom ?? 0} in teachers’ own libraries</p>

      {sharedTotal === 0 && (
        <div className="panel" style={{ padding: "1rem 1.1rem", borderLeft: "3px solid var(--correct-red)", marginBottom: "1rem" }}>
          <strong>No standards are shared yet.</strong> Unlock a grade below, or run <code>npx tsx scripts/seed-standards.ts</code> from a machine with the service key.
        </div>
      )}

      <section className="panel ad-panel" style={{ marginBottom: "16px" }}>
        <div className="ad-panel-head">
          <div className="ad-panel-title"><h2>Unlock standards for everyone</h2></div>
        </div>
        <UnlockStandards />
      </section>

      <section className="panel ad-panel" style={{ marginBottom: "16px" }}>
        <div className="ad-panel-head">
          <div className="ad-panel-title"><h2>Shared library</h2><span className="ad-count">{sharedTotal} standards</span></div>
          <span className="ad-meta">available to every teacher</span>
        </div>
        {shared.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing shared yet.</p> : (
          <div className="ad-table-wrap">
            <table>
              <thead><tr><th>Framework</th><th>Grade</th><th>Subject</th><th className="num">Standards</th><th className="num">Full detail</th><th>Status</th><th>Updated</th></tr></thead>
              <tbody>
                {shared.map((r) => {
                  const full = r.detailed === r.standards;
                  return (
                    <tr key={`${r.framework}|${r.grade}|${r.subject}`}>
                      <td>{r.framework}</td><td>{r.grade === "0" ? "K" : r.grade}</td><td>{r.subject}</td>
                      <td className="num">{r.standards}</td><td className="num">{r.detailed}</td>
                      <td>{full ? <span className="pill pill-ok">complete</span> : <span className="pill pill-warn" title="Codes and wording only. Use Refresh above to add skills, depth of knowledge, misconception, and example.">needs refresh</span>}</td>
                      <td className="muted">{fmtRel(r.updated_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="ad-grid two">
        <section className="panel">
          <table>
            <thead><tr><th>Jurisdiction</th><th>Framework</th><th>Subject</th><th>Grade</th><th className="num">Standards</th><th className="num">Embedded</th><th>Retrieval</th></tr></thead>
            <tbody>
              {cov.length === 0 && <tr><td colSpan={7} className="muted">Nothing seeded.</td></tr>}
              {cov.map((c, i) => (
                <tr key={i}>
                  <td>{c.jurisdiction}</td><td>{c.framework}</td><td>{c.subject}</td><td>{c.grade}</td>
                  <td className="num">{c.standards}</td><td className="num">{c.embedded}</td>
                  <td><span className={`pill ${Number(c.embedded) === Number(c.standards) ? "pill-ok" : Number(c.embedded) > 0 ? "pill-warn" : "pill-bad"}`}>{Number(c.embedded) === Number(c.standards) ? "ready" : Number(c.embedded) > 0 ? "partial" : "none"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel" style={{ padding: "1.1rem" }}>
          <h2 style={{ margin: "0 0 .5rem" }}>Codes in use with no matching standard</h2>
          <p className="muted" style={{ fontSize: ".85rem", marginTop: 0 }}>
            These appear on questions but aren't in the table — either a grade you haven't loaded yet, or a code the model invented. Load the grade, then re-run <code>migrate_workspace</code> to link them.
          </p>
          {topUnlinked.length === 0 ? <p className="muted">All question codes are linked.</p> : (
            <table>
              <thead><tr><th>Code</th><th className="num">Questions</th></tr></thead>
              <tbody>{topUnlinked.map(([code, n]) => <tr key={code}><td className="mono">{code}</td><td className="num">{n}</td></tr>)}</tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
