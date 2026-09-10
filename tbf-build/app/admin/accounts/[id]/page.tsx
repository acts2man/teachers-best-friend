import { notFound } from "next/navigation";
import Link from "next/link";
import { getAccount, getTeacherScans, getTeacherAudit, getPipeline, supabaseAdmin } from "@/lib/supabase-admin";
import { setPlan, setStatus, setAdminRole, resetTeacher, addInternalNote } from "@/app/admin/actions";
import { fmtUsd, fmtBytes, fmtRel, fmtDate } from "@/components/admin/format";

export default async function AccountDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [a, scans, audit, { models }] = await Promise.all([getAccount(id), getTeacherScans(id), getTeacherAudit(id), getPipeline()]);
  if (!a) notFound();
  const { data: plans } = await supabaseAdmin().from("plans").select("id,name,price_cents,scan_quota").eq("active", true).order("sort_order");
  const { data: prof } = await supabaseAdmin().from("profiles").select("internal_notes, grade_levels, subjects, onboarded_at").eq("id", id).single();

  const pct = a.scan_quota ? Math.round((a.scans_this_period / a.scan_quota) * 100) : 0;
  const completed = scans.filter((s) => s.status === "complete");
  const hits = completed.reduce((n, s) => n + Number(s.library_hits), 0);
  const misses = completed.reduce((n, s) => n + Number(s.library_misses), 0);
  const hitRate = hits + misses ? Math.round((100 * hits) / (hits + misses)) : null;

  return (
    <>
      <p style={{ marginBottom: ".5rem" }}><Link href="/admin/accounts">← Accounts</Link></p>
      <h1 style={{ display: "flex", alignItems: "center", gap: ".75rem", flexWrap: "wrap" }}>
        {a.email}
        <span className={`pill ${a.status === "active" ? "pill-ok" : "pill-bad"}`}>{a.status}</span>
        {a.is_admin && <span className="pill pill-ok">admin</span>}
      </h1>
      <p className="ad-sub">
        {[a.full_name, a.school_name, a.district].filter(Boolean).join(" · ") || "No profile details"}
        {" · "}signed up {fmtRel(a.signed_up_at)} · last seen {fmtRel(a.last_seen_at)}
      </p>

      <div className="ad-grid kpi">
        <Kpi v={`${a.scans_this_period} / ${a.scan_quota}`} l="Scans this period" d={`${pct}% of quota · resets ${new Date(a.current_period_end).toLocaleDateString()}`} tone={pct >= 100 ? "bad" : pct >= 80 ? "warn" : undefined} />
        <Kpi v={fmtUsd(a.ai_cost_this_period, 3)} l="AI cost this period" d={`${fmtUsd(a.ai_cost_lifetime, 2)} lifetime`} />
        <Kpi v={a.price_cents ? fmtUsd(a.price_cents / 100) : "$0"} l={`${a.plan_name} plan`} d={a.price_cents ? `margin ${fmtUsd(a.price_cents / 100 - a.ai_cost_this_period, 2)}` : "free tier"} tone={a.price_cents && a.ai_cost_this_period > a.price_cents / 100 ? "bad" : undefined} />
        <Kpi v={hitRate === null ? "—" : `${hitRate}%`} l="Cache hit rate" d={`${hits} hits · ${misses} misses`} />
        <Kpi v={a.students} l="Students" d={`${a.classes} classes · ${a.assessments} assessments`} />
        <Kpi v={fmtBytes(a.storage_bytes)} l="Stored uploads" d={`${a.uploads} files`} />
      </div>

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

          <form action={addInternalNote} style={{ display: "grid", gap: ".5rem" }}>
            <input type="hidden" name="teacher_id" value={a.teacher_id} />
            <label style={{ fontWeight: 600 }}>Internal notes <span className="muted" style={{ fontWeight: 400 }}>— never shown to the teacher</span></label>
            <textarea name="notes" rows={3} defaultValue={prof?.internal_notes ?? ""} placeholder="Context for other admins" />
            <div><button className="btn btn-quiet btn-sm">Save notes</button></div>
          </form>

          <details style={{ borderTop: "1px solid var(--rule-faint)", paddingTop: "1rem" }}>
            <summary style={{ cursor: "pointer", color: "var(--correct-red)", fontWeight: 600 }}>Reset this account's data</summary>
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
          <h2 style={{ margin: "0 0 .75rem" }}>Recent scans</h2>
          {scans.length === 0 ? <p className="muted">No scans yet.</p> : (
            <table>
              <thead><tr><th>When</th><th>Status</th><th>Models</th><th className="num">Cache</th><th className="num">Cost</th></tr></thead>
              <tbody>
                {scans.slice(0, 25).map((s) => (
                  <tr key={s.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDate(s.created_at)}</td>
                    <td>
                      <span className={`pill ${s.status === "complete" ? "pill-ok" : s.status === "failed" ? "pill-bad" : "pill-warn"}`}>{s.status}</span>
                      {s.error && <div className="muted" style={{ fontSize: ".75rem", maxWidth: "18rem" }}>{s.error}</div>}
                    </td>
                    <td className="mono">{[s.extract_model, s.reteach_model].filter(Boolean).map((m) => m!.replace("gpt-", "")).join(" + ") || "—"}</td>
                    <td className="num">{s.library_hits}/{Number(s.library_hits) + Number(s.library_misses)}</td>
                    <td className="num">{fmtUsd(s.cost_usd, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2 style={{ margin: "1.5rem 0 .75rem" }}>Admin history</h2>
          {audit.length === 0 ? <p className="muted">No admin actions on this account.</p> : (
            <table>
              <tbody>
                {audit.map((r) => (
                  <tr key={r.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDate(r.created_at)}</td>
                    <td><strong>{r.action}</strong> <span className="muted">by {r.actor_email}</span>
                      {r.detail && <div className="mono muted" style={{ fontSize: ".72rem" }}>{JSON.stringify(r.detail)}</div>}</td>
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
      {d && <div className={`kpi-d ${tone ? `kpi-${tone}` : "muted"}`}>{d}</div>}
    </div>
  );
}
