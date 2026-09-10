import Link from "next/link";
import { getAudit } from "@/lib/supabase-admin";
import { fmtDate } from "@/components/admin/format";

export default async function AuditPage() {
  const rows = await getAudit(300);

  return (
    <>
      <h1>Audit log</h1>
      <p className="ad-sub">Every admin action, permanently. This table has no delete policy for anyone.</p>

      <div className="panel">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="muted">No admin actions recorded yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDate(r.created_at)}</td>
                <td>{r.actor_email ?? <span className="muted">system</span>}</td>
                <td><strong>{r.action}</strong></td>
                <td>
                  {r.target_type === "teacher" && r.target_id ? <Link href={`/admin/accounts/${r.target_id}`} className="mono">{r.target_id.slice(0, 8)}…</Link>
                    : r.target_type === "ticket" ? <Link href={`/admin/tickets#${r.target_id}`} className="mono">ticket</Link>
                    : r.target_type === "reteaching" ? <Link href={`/admin/library?id=${r.target_id}`} className="mono">library</Link>
                    : <span className="mono">{r.target_type} {r.target_id}</span>}
                </td>
                <td className="mono muted" style={{ fontSize: ".72rem", maxWidth: "36rem", wordBreak: "break-word" }}>{r.detail ? JSON.stringify(r.detail) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
