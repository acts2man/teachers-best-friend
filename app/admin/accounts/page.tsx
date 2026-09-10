import Link from "next/link";
import { getAccounts, type AdminAccount } from "@/lib/supabase-admin";
import { fmtUsd, fmtBytes, fmtRel } from "@/components/admin/format";

type Search = { q?: string; filter?: string; sort?: string };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const all = await getAccounts();

  let rows = all;
  const q = (sp.q ?? "").toLowerCase();
  if (q) rows = rows.filter((a) => [a.email, a.full_name, a.school_name, a.district].some((v) => v?.toLowerCase().includes(q)));
  switch (sp.filter) {
    case "paying":     rows = rows.filter((a) => a.price_cents > 0); break;
    case "free":       rows = rows.filter((a) => a.price_cents === 0); break;
    case "at_quota":   rows = rows.filter((a) => a.scan_quota > 0 && a.scans_this_period >= a.scan_quota); break;
    case "suspended":  rows = rows.filter((a) => a.status !== "active"); break;
    case "admins":     rows = rows.filter((a) => a.is_admin); break;
    case "inactive":   rows = rows.filter((a) => !a.last_seen_at || Date.now() - new Date(a.last_seen_at).getTime() > 30 * 86400e3); break;
  }
  const sortKey = (sp.sort ?? "last_seen") as keyof AdminAccount | "last_seen";
  rows = [...rows].sort((a, b) => {
    if (sortKey === "last_seen") return (new Date(b.last_seen_at ?? 0).getTime()) - (new Date(a.last_seen_at ?? 0).getTime());
    const av = a[sortKey as keyof AdminAccount] as number, bv = b[sortKey as keyof AdminAccount] as number;
    return Number(bv) - Number(av);
  });

  const filters = [
    ["", "All"], ["paying", "Paying"], ["free", "Free"], ["at_quota", "At quota"],
    ["inactive", "Inactive 30d"], ["suspended", "Suspended"], ["admins", "Admins"],
  ];

  return (
    <>
      <h1>Accounts</h1>
      <p className="ad-sub">{all.length} teachers · {all.filter((a) => a.price_cents > 0).length} paying · {all.filter((a) => a.status !== "active").length} suspended</p>

      <div className="toolbar">
        <form method="get">
          <input type="hidden" name="filter" value={sp.filter ?? ""} />
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search email, name, school" style={{ width: "18rem" }} aria-label="Search accounts" />
          <button className="btn btn-quiet btn-sm">Search</button>
        </form>
        <div style={{ display: "flex", gap: ".35rem", flexWrap: "wrap" }}>
          {filters.map(([k, label]) => (
            <Link key={k} href={`/admin/accounts?filter=${k}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}
                  className={`pill ${(sp.filter ?? "") === k ? "pill-ok" : "pill-mute"}`} style={{ textDecoration: "none" }}>
              {label}
            </Link>
          ))}
        </div>
      </div>

      <div className="panel" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Teacher</th>
              <th>Plan</th>
              <th className="num"><SortLink k="scans_this_period" cur={sortKey}>Scans</SortLink></th>
              <th className="num">Quota</th>
              <th className="num"><SortLink k="ai_cost_this_period" cur={sortKey}>AI cost</SortLink></th>
              <th className="num"><SortLink k="students" cur={sortKey}>Students</SortLink></th>
              <th className="num"><SortLink k="assessments" cur={sortKey}>Assessments</SortLink></th>
              <th className="num"><SortLink k="storage_bytes" cur={sortKey}>Storage</SortLink></th>
              <th className="num">Tickets</th>
              <th><SortLink k="last_seen" cur={sortKey}>Last seen</SortLink></th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={11} className="muted">No accounts match.</td></tr>}
            {rows.map((a) => {
              const pct = a.scan_quota ? Math.min(100, Math.round((a.scans_this_period / a.scan_quota) * 100)) : 0;
              return (
                <tr key={a.teacher_id}>
                  <td>
                    <Link href={`/admin/accounts/${a.teacher_id}`}>{a.email}</Link>
                    <div className="muted" style={{ fontSize: ".78rem" }}>
                      {[a.full_name, a.school_name].filter(Boolean).join(" · ")}{a.is_admin && <span className="pill pill-ok" style={{ marginLeft: ".4rem" }}>admin</span>}
                    </div>
                  </td>
                  <td>{a.plan_name}<div className="muted" style={{ fontSize: ".78rem" }}>{a.price_cents ? fmtUsd(a.price_cents / 100) + "/mo" : "free"}</div></td>
                  <td className="num">
                    {a.scans_this_period}
                    <div style={{ height: 3, background: "var(--rule-faint)", marginTop: 4, borderRadius: 2 }}>
                      <div style={{ height: 3, width: `${pct}%`, background: pct >= 100 ? "var(--correct-red)" : pct >= 80 ? "#C9A227" : "var(--mark)", borderRadius: 2 }} />
                    </div>
                  </td>
                  <td className="num">{a.scan_quota}</td>
                  <td className="num">{fmtUsd(a.ai_cost_this_period, 3)}</td>
                  <td className="num">{a.students}</td>
                  <td className="num">{a.assessments}</td>
                  <td className="num">{fmtBytes(a.storage_bytes)}</td>
                  <td className="num">{a.open_tickets || ""}</td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtRel(a.last_seen_at)}</td>
                  <td><span className={`pill ${a.status === "active" ? "pill-ok" : "pill-bad"}`}>{a.status}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SortLink({ k, cur, children }: { k: string; cur: string; children: React.ReactNode }) {
  return <Link href={`/admin/accounts?sort=${k}`} style={{ textDecoration: "none", color: cur === k ? "var(--mark-deep)" : "inherit" }}>{children}{cur === k ? " ↓" : ""}</Link>;
}
