import Link from "next/link";
import { getPlatformStats, getDailyUsage, getAccounts, getTickets } from "@/lib/supabase-admin";
import { UsageChart } from "@/components/admin/usage-chart";
import { fmtUsd, fmtBytes, fmtRel } from "@/components/admin/format";

export default async function AdminOverview() {
  const [stats, daily, accounts, tickets] = await Promise.all([
    getPlatformStats(), getDailyUsage(), getAccounts(), getTickets(),
  ]);

  const openTickets = tickets.filter((t) => t.status === "open" || t.status === "escalated").slice(0, 5);
  const last30 = daily.slice(-30);
  const grossMargin = stats.mrr_usd > 0 ? (1 - stats.ai_cost_this_month / stats.mrr_usd) * 100 : null;
  const costPerTeacher = stats.teachers_active_30d > 0 ? stats.ai_cost_this_month / stats.teachers_active_30d : 0;

  // What needs a human today
  const attention: { level: "bad" | "warn" | "ok"; text: string; href: string }[] = [];
  if (stats.failed_scans_24h > 0) attention.push({ level: "bad", text: `${stats.failed_scans_24h} scans failed in the last 24 hours`, href: "/admin/usage" });
  if (stats.open_tickets > 0) attention.push({ level: "warn", text: `${stats.open_tickets} support ticket${stats.open_tickets === 1 ? "" : "s"} waiting`, href: "/admin/tickets" });
  if (stats.standards_seeded === 0) attention.push({ level: "bad", text: "Standards table is empty — alignment is running on model recall", href: "/admin/standards" });
  if (stats.reteaching_unreviewed > 20) attention.push({ level: "warn", text: `${stats.reteaching_unreviewed} reteaching entries auto-generated and unreviewed`, href: "/admin/library" });
  if (stats.uploads_expiring_7d > 0) attention.push({ level: "ok", text: `${stats.uploads_expiring_7d} uploads will be purged within 7 days`, href: "/admin/usage" });
  const overQuota = accounts.filter((a) => a.scans_this_period >= a.scan_quota && a.scan_quota > 0);
  if (overQuota.length) attention.push({ level: "warn", text: `${overQuota.length} account${overQuota.length === 1 ? "" : "s"} at quota — upgrade candidates`, href: "/admin/accounts?filter=at_quota" });

  return (
    <>
      <h1>Overview</h1>
      <p className="ad-sub">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>

      <div className="ad-grid kpi">
        <Kpi v={stats.teachers_total} l="Teachers" d={`${stats.teachers_active_7d} active this week · ${stats.signups_7d} new`} />
        <Kpi v={fmtUsd(stats.mrr_usd)} l="Monthly revenue" d={`${stats.paying_teachers} paying`} />
        <Kpi v={fmtUsd(stats.ai_cost_this_month, 2)} l="AI cost this month" d={`${fmtUsd(costPerTeacher, 2)} per active teacher`} tone={costPerTeacher > 5 ? "warn" : "good"} />
        <Kpi v={grossMargin === null ? "—" : `${grossMargin.toFixed(0)}%`} l="Gross margin" d={grossMargin === null ? "No revenue yet" : grossMargin < 60 ? "Below target" : "Healthy"} tone={grossMargin === null ? undefined : grossMargin < 60 ? "bad" : "good"} />
        <Kpi v={stats.cache_hit_rate_pct === null ? "—" : `${stats.cache_hit_rate_pct}%`} l="Reteaching cache hit rate" d="The number that decides margins" tone={stats.cache_hit_rate_pct === null ? undefined : stats.cache_hit_rate_pct < 50 ? "warn" : "good"} />
        <Kpi v={stats.scans_this_month} l="Scans this month" d={`${stats.scans_today} today · ${fmtUsd(stats.avg_cost_per_scan, 4)} avg`} />
        <Kpi v={fmtBytes(stats.storage_bytes_total)} l="Stored uploads" d={`${stats.uploads_expiring_7d} expiring this week`} />
        <Kpi v={stats.standards_seeded} l="Standards seeded" d={stats.standards_seeded === 0 ? "Alignment on model recall" : "With embeddings"} tone={stats.standards_seeded === 0 ? "bad" : "good"} />
      </div>

      <div className="ad-grid two" style={{ marginTop: "1.5rem" }}>
        <section className="panel" style={{ padding: "1.1rem" }}>
          <h2 style={{ margin: "0 0 .75rem" }}>Last 30 days</h2>
          <UsageChart data={last30} />
        </section>

        <section className="panel" style={{ padding: "1.1rem" }}>
          <h2 style={{ margin: "0 0 .75rem" }}>Needs attention</h2>
          {attention.length === 0 ? (
            <p className="muted">Nothing. Go teach something.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: ".5rem" }}>
              {attention.map((a, i) => (
                <li key={i} style={{ display: "flex", gap: ".6rem", alignItems: "baseline" }}>
                  <span className={`pill pill-${a.level === "ok" ? "mute" : a.level}`} style={{ minWidth: "3.2rem", textAlign: "center" }}>
                    {a.level === "bad" ? "Now" : a.level === "warn" ? "Soon" : "FYI"}
                  </span>
                  <Link href={a.href}>{a.text}</Link>
                </li>
              ))}
            </ul>
          )}

          <h2 style={{ margin: "1.5rem 0 .75rem" }}>Open tickets</h2>
          {openTickets.length === 0 ? <p className="muted">Queue is empty.</p> : (
            <table>
              <tbody>
                {openTickets.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{t.ticket_ref}</td>
                    <td><Link href={`/admin/tickets#${t.id}`}>{t.subject}</Link><div className="muted" style={{ fontSize: ".8rem" }}>{t.teacher_email}</div></td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtRel(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="panel" style={{ padding: "1.1rem", marginTop: "1rem" }}>
        <h2 style={{ margin: "0 0 .75rem" }}>Most active teachers this period</h2>
        <table>
          <thead><tr><th>Teacher</th><th>Plan</th><th className="num">Scans</th><th className="num">Quota</th><th className="num">AI cost</th><th>Last seen</th></tr></thead>
          <tbody>
            {[...accounts].sort((a, b) => b.scans_this_period - a.scans_this_period).slice(0, 8).map((a) => (
              <tr key={a.teacher_id}>
                <td><Link href={`/admin/accounts/${a.teacher_id}`}>{a.email}</Link></td>
                <td>{a.plan_name}</td>
                <td className="num">{a.scans_this_period}</td>
                <td className="num">{a.scan_quota}</td>
                <td className="num">{fmtUsd(a.ai_cost_this_period, 3)}</td>
                <td className="muted">{fmtRel(a.last_seen_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Kpi({ v, l, d, tone }: { v: string | number; l: string; d?: string; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="panel kpi-card">
      <div className="kpi-v">{v}</div>
      <div className="kpi-l">{l}</div>
      {d && <div className={`kpi-d ${tone ? `kpi-${tone}` : "muted"}`}>{d}</div>}
    </div>
  );
}
