import { notFound } from "next/navigation";
import Link from "next/link";
import { Eye } from "lucide-react";
import { getAccount, getTeacherScans, getTeacherAudit, getPipeline, getCostBreakdown, supabaseAdmin } from "@/lib/supabase-admin";
import { setPlan, setStatus, setAdminRole, setAppManagerRole, resetTeacher, addInternalNote, clearFailedScans } from "@/app/admin/actions";
import { startImpersonation } from "@/lib/impersonation-actions";
import { currentIsAppManager } from "@/lib/admin-gate";
import { fmtUsd, fmtBytes, fmtRel, fmtDate, fmtCents, fmtInt, stageInfo, modelLabel, describeAudit } from "@/components/admin/format";

const TARGET_COST_PER_SCAN = 0.01;

export default async function AccountDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [a, scans, audit, { models }, breakdown, appManager] = await Promise.all([getAccount(id), getTeacherScans(id), getTeacherAudit(id), getPipeline(), getCostBreakdown({ teacherId: id }), currentIsAppManager()]);
  if (!a) notFound();
  const { data: plans } = await supabaseAdmin().from("plans").select("id,name,price_cents,scan_quota").eq("active", true).order("sort_order");
  const { data: prof } = await supabaseAdmin().from("profiles").select("internal_notes, grade_levels, subjects, onboarded_at").eq("id", id).single();

  const pct = a.scan_quota ? Math.round((a.scans_this_period / a.scan_quota) * 100) : 0;
  const completed = scans.filter((s) => s.status === "complete");
  const hits = completed.reduce((n, s) => n + Number(s.library_hits), 0);
  const misses = completed.reduce((n, s) => n + Number(s.library_misses), 0);
  const hitRate = hits + misses ? Math.round((100 * hits) / (hits + misses)) : null;
  const avgPerScan = a.scans_this_period ? a.ai_cost_this_period / a.scans_this_period : 0;
  const avgRatio = avgPerScan / TARGET_COST_PER_SCAN;
  const okScans = scans.filter((s) => s.status === "complete");
  const badScans = scans.filter((s) => s.status === "failed" || s.status === "canceled");
  const badCost = badScans.reduce((n, s) => n + Number(s.cost_usd), 0);
  const workRows = [...breakdown].sort((x, y) => Number(y.cost_usd) - Number(x.cost_usd));
  const workTotal = workRows.reduce((n, r) => n + Number(r.cost_usd), 0);

  return (
    <>
      <p style={{ marginBottom: ".5rem" }}><Link href="/admin/accounts">← Accounts</Link></p>
      <h1 style={{ display: "flex", alignItems: "center", gap: ".75rem", flexWrap: "wrap" }}>
        {a.email}
        <span className={`pill ${a.status === "active" ? "pill-ok" : "pill-bad"}`}>{a.status}</span>
        {a.is_admin && <span className="pill pill-ok">admin</span>}
        {a.is_app_manager && <span className="pill pill-ok">app manager</span>}
      </h1>
      <p className="ad-sub" style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <span>
          {[a.full_name, a.school_name, a.district].filter(Boolean).join(" · ") || "No profile details"}
          {" · "}signed up {fmtRel(a.signed_up_at)} · last seen {fmtRel(a.last_seen_at)}
        </span>
        {appManager && (
          <form action={startImpersonation}>
            <input type="hidden" name="teacher_id" value={a.teacher_id} />
            <button className="btn btn-quiet btn-sm" type="submit" style={{ display: "inline-flex", alignItems: "center", gap: ".35rem" }}>
              <Eye size={14} />
              View this account
            </button>
          </form>
        )}
      </p>
      {appManager && (
        <p className="ad-meta" style={{ marginTop: "-.6rem", marginBottom: "1.2rem" }}>
          Opens their workspace exactly as they see it, for up to 30 minutes. Logged to the audit trail.
        </p>
      )}

      <div className="ad-grid kpi">
        <Kpi v={`${a.scans_this_period} / ${a.scan_quota}`} l="Scans this period" d={`${pct}% of quota · resets ${new Date(a.current_period_end).toLocaleDateString()}`} tone={pct >= 100 ? "bad" : pct >= 80 ? "warn" : undefined} />
        <Kpi v={fmtCents(a.ai_cost_this_period)} l="AI cost this period" d={`${fmtCents(a.ai_cost_lifetime)} lifetime`} />
        <Kpi v={fmtCents(avgPerScan)} l="Average cost per scan" d={avgPerScan === 0 ? "No scans yet this period" : avgRatio <= 1 ? `At or under the ${fmtCents(TARGET_COST_PER_SCAN)} target` : `${avgRatio.toFixed(1)}× the ${fmtCents(TARGET_COST_PER_SCAN)} target`} tone={avgPerScan === 0 ? undefined : avgRatio <= 1 ? "good" : avgRatio <= 2 ? "warn" : "bad"} />
        <Kpi v={a.price_cents ? fmtUsd(a.price_cents / 100) : "$0"} l={`${a.plan_name} plan`} d={a.price_cents ? `margin ${fmtUsd(a.price_cents / 100 - a.ai_cost_this_period, 2)}` : "free tier"} tone={a.price_cents && a.ai_cost_this_period > a.price_cents / 100 ? "bad" : undefined} />
        <Kpi v={hitRate === null ? "—" : `${hitRate}%`} l="Cache hit rate" d={`${hits} hits · ${misses} misses`} />
        <Kpi v={a.students} l="Students" d={`${a.classes} classes · ${a.assessments} assessments`} />
        <Kpi v={fmtBytes(a.storage_bytes)} l="Stored uploads" d={`${a.uploads} files`} />
      </div>

      {/* ---------- Where the AI cost went ---------- */}
      <section className="panel ad-panel ad-section-gap">
        <div className="ad-panel-head">
          <div className="ad-panel-title"><h2>Where this teacher’s AI cost went this month</h2><span className="ad-count">{workRows.length} kinds of work</span></div>
          <span className="ad-meta">Averages rounded to the cent · hover for exact</span>
        </div>
        {workRows.length === 0 ? (
          <div className="ad-empty"><span><strong>No AI calls yet this month.</strong> Rows appear as this teacher scans.</span></div>
        ) : (
          <div className="ad-table-wrap">
            <table>
              <thead><tr><th>Kind of work</th><th>Model used</th><th className="num">Calls</th><th className="num">Failed</th><th className="num">Average per call</th><th className="num">Total</th><th className="num">Share</th></tr></thead>
              <tbody>
                {workRows.map((r) => {
                  const info = stageInfo(r.stage);
                  const perCall = r.completed ? Number(r.cost_usd) / r.completed : r.calls ? Number(r.cost_usd) / r.calls : 0;
                  const tone = perCall > TARGET_COST_PER_SCAN * 2 ? "bad" : perCall > TARGET_COST_PER_SCAN ? "warn" : "good";
                  return (
                    <tr key={`${r.stage}|${r.model}`}>
                      <td><strong>{info.label}</strong><div className="muted" style={{ fontSize: ".78rem" }}>{info.what}{info.unit ? ` · ${info.unit}` : ""}</div></td>
                      <td>{modelLabel(r.model)}<div className="mono muted" style={{ fontSize: ".72rem" }}>{r.model}</div></td>
                      <td className="num">{fmtInt(r.calls)}</td>
                      <td className="num">{r.failed ? <span className="pill pill-bad">{r.failed}</span> : <span className="muted">0</span>}</td>
                      <td className="num"><span className={`kpi-delta ${tone}`} title={`exact: ${fmtUsd(perCall, 4)}`}>{fmtCents(perCall)}</span></td>
                      <td className="num" title={`exact: ${fmtUsd(r.cost_usd, 4)}`}>{fmtCents(r.cost_usd)}</td>
                      <td className="num muted">{workTotal ? Math.round((100 * Number(r.cost_usd)) / workTotal) : 0}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="ad-grid two" style={{ marginTop: "1.5rem" }}>
        {/* ---------- Actions ---------- */}
        <section className="panel" style={{ padding: "1.1rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <h2 style={{ margin: 0 }}>Manage</h2>

          <form action={setPlan} style={{ display: "grid", gap: ".5rem" }}>
            <input type="hidden" name="teacher_id" value={a.teacher_id} />
            <label style={{ fontWeight: 600 }}>Plan</label>
            <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
              <select name="plan_id" defaultValue={a.plan_id}>
                {plans?.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.price_cents ? fmtUsd(p.price_cents / 100) + "/mo" : "free"} · {p.scan_quota} scans</option>)}
              </select>
              <input name="reason" placeholder="Reason (audited)" style={{ flex: 1, minWidth: "10rem" }} />
              <button className="btn btn-quiet btn-sm">Change plan</button>
            </div>
            <p className="muted" style={{ fontSize: ".8rem", margin: 0 }}>Overrides Stripe until the next webhook. Use for comps, trials, and manual fixes.</p>
          </form>

          <form action={setStatus} style={{ display: "grid", gap: ".5rem" }}>
            <input type="hidden" name="teacher_id" value={a.teacher_id} />
            <label style={{ fontWeight: 600 }}>Account status</label>
            <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
              <select name="status" defaultValue={a.status}>
                <option value="active">Active</option>
                <option value="suspended">Suspended — cannot scan</option>
                <option value="deactivated">Deactivated</option>
              </select>
              <input name="reason" placeholder="Reason (shown to teacher)" defaultValue={a.status_reason ?? ""} style={{ flex: 1, minWidth: "10rem" }} />
              <button className="btn btn-quiet btn-sm">Update status</button>
            </div>
          </form>

          <form action={setAdminRole} style={{ display: "flex", gap: ".5rem", alignItems: "center", flexWrap: "wrap" }}>
            <input type="hidden" name="teacher_id" value={a.teacher_id} />
            <input type="hidden" name="is_admin" value={a.is_admin ? "false" : "true"} />
            <span style={{ fontWeight: 600 }}>Admin access</span>
            <button className={`btn btn-sm ${a.is_admin ? "btn-danger" : "btn-quiet"}`}>{a.is_admin ? "Revoke admin" : "Grant admin"}</button>
          </form>

          {appManager && (
            <form action={setAppManagerRole} style={{ display: "flex", gap: ".5rem", alignItems: "center", flexWrap: "wrap" }}>
              <input type="hidden" name="teacher_id" value={a.teacher_id} />
              <input type="hidden" name="is_app_manager" value={a.is_app_manager ? "false" : "true"} />
              <span style={{ fontWeight: 600 }}>App manager access</span>
              <button className={`btn btn-sm ${a.is_app_manager ? "btn-danger" : "btn-quiet"}`}>{a.is_app_manager ? "Revoke app manager" : "Grant app manager"}</button>
              <span className="ad-meta">Can view any teacher’s account, in addition to admin access</span>
            </form>
          )}

          <form action={addInternalNote} style={{ display: "grid", gap: ".5rem" }}>
            <input type="hidden" name="teacher_id" value={a.teacher_id} />
            <label style={{ fontWeight: 600 }}>Internal notes <span className="muted" style={{ fontWeight: 400 }}>— never shown to the teacher</span></label>
            <textarea name="notes" rows={3} defaultValue={prof?.internal_notes ?? ""} placeholder="Context for other admins" />
            <div><button className="btn btn-quiet btn-sm">Save notes</button></div>
          </form>

          <details style={{ borderTop: "1px solid var(--rule-faint)", paddingTop: "1rem" }}>
            <summary style={{ cursor: "pointer", color: "var(--correct-red)", fontWeight: 600 }}>Reset this account’s data</summary>
            <form action={resetTeacher} style={{ display: "grid", gap: ".5rem", marginTop: ".75rem" }}>
              <input type="hidden" name="teacher_id" value={a.teacher_id} />
              <p className="muted" style={{ margin: 0, fontSize: ".85rem" }}>
                Deletes all classes, students, assessments, responses, and uploaded files. Keeps the login, profile, plan, and settings. Cannot be undone.
              </p>
              <label style={{ fontSize: ".85rem" }}><input type="checkbox" name="keep_scans" value="true" defaultChecked /> Keep scan history (billing records)</label>
              <div style={{ display: "flex", gap: ".5rem" }}>
                <input name="confirm" placeholder='Type RESET' style={{ width: "8rem" }} />
                <button className="btn btn-danger btn-sm">Reset account</button>
              </div>
            </form>
          </details>
        </section>

        {/* ---------- Recent scans ---------- */}
        <section className="panel" style={{ padding: "1.1rem" }}>
          <div className="ad-panel-head">
            <div className="ad-panel-title"><h2>Recent scans</h2><span className="ad-count">{okScans.length} completed</span></div>
          </div>
          {okScans.length === 0 ? <div className="ad-empty"><span><strong>No completed scans yet.</strong></span></div> : (
            <div className="ad-table-wrap">
              <table>
                <thead><tr><th>When</th><th>Kind of work</th><th>Model</th><th className="num">Cost</th></tr></thead>
                <tbody>
                  {okScans.slice(0, 25).map((s) => (
                    <tr key={s.id}>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDate(s.created_at)}</td>
                      <td>{stageInfo(s.stage).label}</td>
                      <td>{[s.extract_model, s.reteach_model].filter(Boolean).map((m) => modelLabel(m)).join(" + ") || "—"}</td>
                      <td className="num" title={`exact: ${fmtUsd(s.cost_usd, 4)}`}>{fmtCents(s.cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {badScans.length > 0 && (
            <details style={{ marginTop: "1rem", border: "1px solid var(--ad-hair)", borderRadius: "var(--ad-r-2)", padding: ".6rem .9rem" }}>
              <summary style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                <span><span className="pill pill-bad">{badScans.length} failed</span> <span className="muted" style={{ fontSize: ".85rem" }}>scans that did not finish · {fmtCents(badCost)} spent on them</span></span>
                <span className="muted" style={{ fontSize: ".8rem" }}>show</span>
              </summary>
              <div className="ad-table-wrap" style={{ marginTop: ".75rem" }}>
                <table>
                  <thead><tr><th>When</th><th>Kind of work</th><th>What went wrong</th><th className="num">Cost</th></tr></thead>
                  <tbody>
                    {badScans.map((s) => (
                      <tr key={s.id}>
                        <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDate(s.created_at)}</td>
                        <td>{stageInfo(s.stage).label}</td>
                        <td className="muted" style={{ fontSize: ".8rem", maxWidth: "22rem" }}>{s.error ?? s.status}</td>
                        <td className="num">{fmtCents(s.cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <form action={clearFailedScans} style={{ marginTop: ".75rem", display: "flex", gap: ".75rem", alignItems: "center", flexWrap: "wrap" }}>
                <input type="hidden" name="teacher_id" value={a.teacher_id} />
                <button className="btn btn-quiet btn-sm">Clear failed scans</button>
                <span className="muted" style={{ fontSize: ".8rem" }}>Removes these rows. The count, cost, and errors are kept in the admin history.</span>
              </form>
            </details>
          )}

          <h2 style={{ margin: "1.5rem 0 .75rem" }}>Admin history</h2>
          {audit.length === 0 ? <p className="muted">No admin actions on this account.</p> : (
            <table>
              <tbody>
                {audit.map((r) => (
                  <tr key={r.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDate(r.created_at)}</td>
                    <td title={r.detail ? JSON.stringify(r.detail) : undefined}>{describeAudit(r.action, r.detail as Record<string, unknown> | null)} <span className="muted">by {r.actor_email}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}

function Kpi({ v, l, d, tone }: { v: string | number; l: string; d?: string; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="panel kpi-card">
      <div className="kpi-v" style={{ fontSize: "var(--t-4)" }}>{v}</div>
      <div className="kpi-l">{l}</div>
      {d && (tone ? <div className="kpi-foot"><span className={`kpi-delta ${tone}`}>{d}</span></div> : <div className="kpi-d muted">{d}</div>)}
    </div>
  );
}
