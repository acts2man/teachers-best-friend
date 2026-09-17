import Link from "next/link";
import { requireAdmin } from "@/lib/admin-gate";
import { getImpersonationSessions } from "@/lib/supabase-admin";
import { fmtDate } from "@/components/admin/format";

export const dynamic = "force-dynamic";

function duration(startIso: string, endIso: string | null) {
  if (!endIso) return "—";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "under a minute";
  if (mins < 60) return mins + (mins === 1 ? " minute" : " minutes");
  const hours = Math.floor(mins / 60);
  return hours + (hours === 1 ? " hour " : " hours ") + (mins % 60) + " min";
}

export default async function ImpersonationPage() {
  await requireAdmin();
  const sessions = await getImpersonationSessions();
  const open = sessions.filter((s) => !s.ended_at);

  return (
    <>
      <h1>View-as sessions</h1>
      <p className="ad-sub">
        Every time someone opened another person&rsquo;s account. Viewing is
        read-only — saving, uploading and scanning are refused for the whole
        session — so nothing here changed a teacher&rsquo;s work.
        {open.length > 0 && ` ${open.length} open right now.`}
      </p>

      <div className="panel" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Started</th>
              <th>Who looked</th>
              <th>Whose account</th>
              <th>Lasted</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Nobody has viewed another account yet.
                </td>
              </tr>
            )}
            {sessions.map((s) => (
              <tr key={s.id}>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>
                  {fmtDate(s.created_at)}
                </td>
                <td>{s.actor_email ?? <span className="muted">unknown</span>}</td>
                <td>
                  <Link href={`/admin/accounts/${s.teacher_id}`}>
                    {s.teacher_email ?? s.teacher_id.slice(0, 8) + "…"}
                  </Link>
                </td>
                <td className="muted">{duration(s.created_at, s.ended_at)}</td>
                <td>
                  {s.ended_at ? (
                    <span className="pill pill-mute">Closed</span>
                  ) : (
                    <span className="pill pill-warn">Open</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="panel" style={{ padding: "1.1rem", marginTop: "1rem" }}>
        <h2 style={{ margin: "0 0 .5rem" }}>If someone gets stuck</h2>
        <p style={{ margin: 0, maxWidth: "70ch" }}>
          A session ends when they press &ldquo;Stop viewing&rdquo;, and expires
          on its own after 30 minutes either way. If the button ever fails,
          opening <code>/api/impersonation/clear</code> returns that person to
          their own account immediately.
        </p>
      </section>
    </>
  );
}
