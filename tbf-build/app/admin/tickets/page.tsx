import Link from "next/link";
import { getTickets, supabaseAdmin } from "@/lib/supabase-admin";
import { replyTicket } from "@/app/admin/actions";
import { fmtRel, fmtDate } from "@/components/admin/format";

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const tickets = await getTickets(status || undefined);
  const open = tickets.filter((t) => ["open", "escalated"].includes(t.status));
  const rest = tickets.filter((t) => !["open", "escalated"].includes(t.status));
  const ids = tickets.slice(0, 40).map((t) => t.id);
  const { data: msgs } = ids.length
    ? await supabaseAdmin().from("support_messages").select("ticket_id, author, body, created_at").in("ticket_id", ids).order("created_at")
    : { data: [] as any[] };
  const byTicket = new Map<string, any[]>();
  (msgs ?? []).forEach((m) => byTicket.set(m.ticket_id, [...(byTicket.get(m.ticket_id) ?? []), m]));

  const deflected = tickets.filter((t) => t.deflected).length;

  return (
    <>
      <h1>Tickets</h1>
      <p className="ad-sub">{open.length} waiting · {deflected} answered by AI this list · {tickets.length} total</p>

      <div className="toolbar">
        {[["", "Open & escalated"], ["ai_answered", "AI answered"], ["resolved", "Resolved"], ["closed", "Closed"]].map(([k, l]) => (
          <Link key={k} href={`/admin/tickets${k ? `?status=${k}` : ""}`} className={`pill ${(status ?? "") === k ? "pill-ok" : "pill-mute"}`} style={{ textDecoration: "none" }}>{l}</Link>
        ))}
      </div>

      {(status ? tickets : open).length === 0 && <div className="panel" style={{ padding: "1.5rem" }}><p className="muted" style={{ margin: 0 }}>Nothing here. The queue is clear.</p></div>}

      <div style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
        {(status ? tickets : open).map((t) => (
          <article key={t.id} id={t.id} className="panel" style={{ padding: "1rem 1.1rem" }}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "baseline", flexWrap: "wrap" }}>
              <div>
                <span className="mono muted">{t.ticket_ref}</span>{" "}
                <strong>{t.subject}</strong>
                <div className="muted" style={{ fontSize: ".8rem" }}>
                  <Link href={`/admin/accounts/${t.teacher_id}`}>{t.teacher_email}</Link> · {fmtRel(t.created_at)}{t.category ? ` · ${t.category}` : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: ".4rem" }}>
                <span className={`pill ${t.priority === "urgent" ? "pill-bad" : t.priority === "high" ? "pill-warn" : "pill-mute"}`}>{t.priority}</span>
                <span className={`pill ${t.status === "escalated" ? "pill-bad" : t.status === "open" ? "pill-warn" : "pill-ok"}`}>{t.status}</span>
                {t.deflected && <span className="pill pill-ok">AI {t.ai_confidence != null ? `${Math.round(Number(t.ai_confidence) * 100)}%` : ""}</span>}
              </div>
            </header>

            <div style={{ marginTop: ".75rem", display: "flex", flexDirection: "column", gap: ".5rem" }}>
              {(byTicket.get(t.id) ?? []).map((m, i) => (
                <div key={i} style={{ padding: ".6rem .8rem", borderRadius: "var(--radius)", background: m.author === "teacher" ? "#fff" : m.author === "ai" ? "var(--mark-tint)" : "var(--paper-deep)", border: "1px solid var(--rule-faint)", fontSize: ".92rem" }}>
                  <div className="muted" style={{ fontSize: ".75rem", marginBottom: ".25rem" }}>{m.author === "teacher" ? t.teacher_email : m.author === "ai" ? "AI first-line" : "Staff"} · {fmtDate(m.created_at)}</div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
                </div>
              ))}
            </div>

            {["open", "escalated", "ai_answered"].includes(t.status) && (
              <form action={replyTicket} style={{ marginTop: ".75rem", display: "grid", gap: ".5rem" }}>
                <input type="hidden" name="ticket_id" value={t.id} />
                <textarea name="body" rows={3} required placeholder="Reply to the teacher" />
                <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
                  <select name="status" defaultValue="resolved">
                    <option value="resolved">Send and resolve</option>
                    <option value="open">Send and keep open</option>
                    <option value="closed">Send and close</option>
                  </select>
                  <button className="btn btn-mark btn-sm">Send reply</button>
                </div>
              </form>
            )}
          </article>
        ))}
      </div>

      {!status && rest.length > 0 && (
        <details style={{ marginTop: "1.5rem" }}>
          <summary className="muted" style={{ cursor: "pointer" }}>{rest.length} resolved or closed</summary>
          <div className="panel" style={{ marginTop: ".5rem" }}>
            <table>
              <tbody>
                {rest.slice(0, 50).map((t) => (
                  <tr key={t.id}><td className="mono">{t.ticket_ref}</td><td>{t.subject}</td><td className="muted">{t.teacher_email}</td><td><span className="pill pill-mute">{t.status}</span></td><td className="muted">{fmtRel(t.resolved_at ?? t.updated_at)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}
