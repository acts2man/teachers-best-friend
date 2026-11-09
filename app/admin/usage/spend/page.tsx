import Link from "next/link";
import { getSpendPage } from "@/lib/supabase-admin";
import { SET_STAGES, spendHref, type SpendItem, type SpendSearch as Search } from "@/lib/ai-spend";
import { fmtCents, fmtDate, fmtInt, fmtUsd, stageInfo } from "@/components/admin/format";

/**
 * Every AI call, newest first, paged -- not just the latest 50 (Ricky, 19 Oct
 * 2026). Opened from a kind of work on Usage or on a teacher's account, it
 * lists that kind's items with date, test and cost. A class set's name reads
 * and grading calls are one item with its pages and total (lib/ai-spend.ts),
 * so a 66-page set reads as one set, not 44 unexplained scans.
 */
export default async function SpendPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const from = Number(sp.from) > 0 ? Math.floor(Number(sp.from)) : 0;
  const { items, next, titles, emails, totalCalls } = await getSpendPage({ teacherId: sp.teacher, stage: sp.stage, from });
  const isSet = !!sp.stage && (SET_STAGES as readonly string[]).includes(sp.stage);
  const heading = !sp.stage ? "All AI spend" : isSet ? "Whole-class scans" : stageInfo(sp.stage).label;
  const base: Search = { teacher: sp.teacher, stage: sp.stage };
  const pageCost = items.reduce((n, i) => n + i.cost, 0);
  const testOf = (i: SpendItem) => {
    const id = i.kind === "set" ? i.assessmentId : i.row.assessment_id;
    return id ? (titles.get(id) ?? "A deleted test") : "—";
  };
  return (
    <>
      <p style={{ marginBottom: ".5rem" }}>
        {sp.teacher ? <Link href={`/admin/accounts/${sp.teacher}`}>← Account</Link> : <Link href="/admin/usage">← Usage & cost</Link>}
      </p>
      <h1>{heading}</h1>
      <p className="ad-sub">
        {sp.teacher ? (emails.get(sp.teacher) ?? "One teacher") + " · " : "Every teacher · "}
        {fmtInt(totalCalls)} AI call{totalCalls === 1 ? "" : "s"} in all, newest first · this page {fmtCents(pageCost)}
      </p>
      <p className="muted" style={{ fontSize: ".875rem", margin: "0 0 12px", maxWidth: "78ch" }}>
        A whole class set is many AI calls by design: a <strong>name check</strong> for every few pages, and a{" "}
        <strong>grading call</strong> for each batch of students. Each set is shown here as one row with its pages, its
        calls and what the set cost in total. Open a set to see its calls.
        {isSet && " This list shows the name checks and grading calls together, as sets."}
      </p>
      <nav className="ad-meta" style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "0 0 12px" }} aria-label="Kind of work">
        <Link href={spendHref(base, { stage: undefined, from: undefined })}>All kinds</Link>
        <Link href={spendHref(base, { stage: "class_scan", from: undefined })}>Whole-class scans</Link>
        {["assignment", "answer_key", "key_check", "lesson", "responses", "catalog"].map((s) => (
          <Link key={s} href={spendHref(base, { stage: s, from: undefined })}>
            {stageInfo(s).label}
          </Link>
        ))}
      </nav>
      <section className="panel ad-panel">
        {items.length === 0 ? (
          <div className="ad-empty">
            <span>
              <strong>Nothing here yet.</strong>
            </span>
          </div>
        ) : (
          <div className="ad-table-wrap">
            <table className="spend-table">
              <thead>
                <tr>
                  <th>When</th>
                  {!sp.teacher && <th>Teacher</th>}
                  <th>What</th>
                  <th>Test</th>
                  <th className="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.kind === "set" ? "set-" + i.rows[0].id : i.row.id} data-kind={i.kind}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {fmtDate(i.kind === "set" ? i.start : i.row.created_at)}
                    </td>
                    {!sp.teacher && (
                      <td>
                        {(() => {
                          const t = i.kind === "set" ? i.teacherId : i.row.teacher_id;
                          return <Link href={`/admin/accounts/${t}`}>{emails.get(t) ?? t.slice(0, 8)}</Link>;
                        })()}
                      </td>
                    )}
                    <td>
                      {i.kind === "set" ? (
                        <details>
                          <summary>
                            <strong>Class set</strong> · {i.pages} page{i.pages === 1 ? "" : "s"} · {i.rows.length} AI calls (
                            {i.nameReads} name check{i.nameReads === 1 ? "" : "s"}, {i.gradingCalls} grading)
                            {i.failed > 0 && <span className="pill pill-bad"> {i.failed} failed</span>}
                          </summary>
                          <table>
                            <tbody>
                              {i.rows.map((r) => (
                                <tr key={r.id}>
                                  <td className="muted">{fmtDate(r.created_at)}</td>
                                  <td>
                                    {stageInfo(r.stage).label}
                                    {r.status !== "complete" && <span className="muted"> · {r.status}</span>}
                                  </td>
                                  <td className="num" title={`exact: ${fmtUsd(r.cost_usd, 4)}`}>{fmtCents(r.cost_usd)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </details>
                      ) : (
                        <>
                          {stageInfo(i.row.stage).label}
                          {i.row.status !== "complete" && <span className="muted"> · {i.row.status}</span>}
                        </>
                      )}
                    </td>
                    <td>{testOf(i)}</td>
                    <td className="num" title={`exact: ${fmtUsd(i.cost, 4)}`}>
                      <strong>{fmtCents(i.cost)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", marginTop: ".9rem", flexWrap: "wrap" }}>
          {from > 0 ? <Link href={spendHref(base, { from: undefined })}>← Newest</Link> : <span />}
          {next !== null && <Link href={spendHref(base, { from: String(next) })}>Older →</Link>}
        </div>
      </section>
    </>
  );
}
