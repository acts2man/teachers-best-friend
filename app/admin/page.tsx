import Link from "next/link";
import { Users, DollarSign, Coins, Percent, Zap, ScanLine, HardDrive, Database, ChevronRight, Inbox } from "lucide-react";
import { getPlatformStats, getDailyUsage, getAccounts, getTickets } from "@/lib/supabase-admin";
import { UsageChart } from "@/components/admin/usage-chart";
import { Kpi } from "@/components/admin/kpi";
import { AttentionList, type AttentionItem } from "@/components/admin/attention";
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
  const attention: AttentionItem[] = [];
  if (stats.failed_scans_24h > 0) attention.push({ level: "bad", text: `${stats.failed_scans_24h} scans failed in the last 24 hours`, href: "/admin/usage" });
  if (stats.open_tickets > 0) attention.push({ level: "warn", text: `${stats.open_tickets} support ticket${stats.open_tickets === 1 ? "" : "s"} waiting`, href: "/admin/tickets" });
  if (stats.standards_seeded === 0) attention.push({ level: "bad", text: "Standards table is empty — alignment is running on model recall", href: "/admin/standards" });
  if (stats.reteaching_unreviewed > 20) attention.push({ level: "warn", text: `${stats.reteaching_unreviewed} reteaching entries auto-generated and unreviewed`, href: "/admin/library" });
  if (stats.uploads_expiring_7d > 0) attention.push({ level: "ok", text: `${stats.uploads_expiring_7d} uploads will be purged within 7 days`, href: "/admin/usage" });
  const overQuota = accounts.filter((a) => a.scans_this_period >= a.scan_quota && a.scan_quota > 0);
  if (overQuota.length) attention.push({ level: "warn", text: `${overQuota.length} account${overQuota.length === 1 ? "" : "s"} at quota — upgrade candidates`, href: "/admin/accounts?filter=at_quota" });

  // Trends for the sparklines, where a daily series exists.
  const scanTrend = daily.slice(-14).map((d) => Number(d.scans));
  const costTrend = daily.slice(-14).map((d) => Number(d.ai_cost));
  const mostActive = [...accounts].sort((a, b) => b.scans_this_period - a.scans_this_period).slice(0, 8);

  return (
    <>
      <h1>Overview</h1>
      <p className="ad-sub">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>

      <section className="kpi-grid" aria-label="Key metrics">
        <Kpi tier="primary" style={{ ["--i" as string]: 0 }} icon={<DollarSign />} v={fmtUsd(stats.mrr_usd)} l="Monthly revenue" d={`${stats.paying_teachers} paying`} empty="No paying teachers yet" />
        <Kpi tier="primary" style={{ ["--i" as string]: 1 }} icon={<Coins />} v={fmtUsd(stats.ai_cost_this_month, 2)} l="AI cost this month" d={`${fmtUsd(costPerTeacher, 2)} per active teacher`} tone={costPerTeacher > 5 ? "warn" : "good"} empty="Awaiting first scan" spark={costTrend} sparkId="cost" />
        <Kpi tier="primary" style={{ ["--i" as string]: 2 }} icon={<Percent />} v={grossMargin === null ? "—" : `${grossMargin.toFixed(0)}%`} l="Gross margin" d={grossMargin === null ? "No revenue yet" : grossMargin < 60 ? "Below target" : "Healthy"} tone={grossMargin === null ? undefined : grossMargin < 60 ? "bad" : "good"} empty="No revenue yet" />
        <Kpi tier="primary" style={{ ["--i" as string]: 3 }} icon={<Zap />} v={stats.cache_hit_rate_pct === null ? "—" : `${stats.cache_hit_rate_pct}%`} l="Reteaching cache hit rate" d="The number that decides margins" tone={stats.cache_hit_rate_pct === null ? undefined : stats.cache_hit_rate_pct < 50 ? "warn" : "good"} empty="Awaiting first reteach" />

        <Kpi style={{ ["--i" as string]: 4 }} icon={<Users />} v={stats.teachers_total} l="Teachers" d={`${stats.teachers_active_7d} active this week · ${stats.signups_7d} new`} empty="No teachers yet" />
        <Kpi style={{ ["--i" as string]: 5 }} icon={<ScanLine />} v={stats.scans_this_month} l="Scans this month" d={`${stats.scans_today} today · ${fmtUsd(stats.avg_cost_per_scan, 4)} avg`} empty="Awaiting first scan" spark={scanTrend} sparkId="scans" />
        <Kpi style={{ ["--i" as string]: 6 }} icon={<HardDrive />} v={fmtBytes(stats.storage_bytes_total)} l="Stored uploads" d={`${stats.uploads_expiring_7d} expiring this week`} empty="No uploads yet" />
        <Kpi style={{ ["--i" as string]: 7 }} icon={<Database />} v={stats.standards_seeded} l="Standards seeded" d={stats.standards_seeded === 0 ? "Alignment on model recall" : "With embeddings"} tone={stats.standards_seeded === 0 ? "bad" : "good"} />
      </section>

      <div className="ad-grid two ad-section-gap">
        <section className="panel ad-panel ad-rise" style={{ ["--i" as string]: 8 }}>
          <div className="ad-panel-head">
            <div className="ad-panel-title"><h2>Last 30 days</h2><span className="ad-count">{last30.length} days</span></div>
            <span className="ad-meta"><Link href="/admin/usage">Full 90 days</Link></span>
          </div>
          <UsageChart data={last30} />
        </section>

        <section className="panel ad-panel ad-rise" style={{ ["--i" as string]: 9 }}>
          <div className="ad-panel-head">
            <div className="ad-panel-title"><h2>Needs attention</h2><span className="ad-count">{attention.length}</span></div>
          </div>
          <AttentionList items={attention} emptyText="Nothing. Go teach something." />

          <div className="ad-panel-head" style={{ marginTop: "var(--ad-s-3)" }}>
            <div className="ad-panel-title"><h2>Open tickets</h2><span className="ad-count">{openTickets.length}</span></div>
            <span className="ad-meta"><Link href="/admin/tickets">All tickets</Link></span>
          </div>
          {openTickets.length === 0 ? (
            <div className="ad-empty"><Inbox aria-hidden="true" /><span><strong>Queue is empty.</strong> New tickets land here first.</span></div>
          ) : (
            <div className="ad-table-wrap">
            <table>
              <tbody>
                {openTickets.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{t.ticket_ref}</td>
                    <td><Link href={`/admin/tickets#${t.id}`}>{t.subject}</Link><div className="muted" style={{ fontSize: ".78rem" }}>{t.teacher_email}</div></td>
                    <td className="muted num" style={{ whiteSpace: "nowrap" }}>{fmtRel(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </section>
      </div>

      <section className="panel ad-panel ad-section-gap ad-rise" style={{ ["--i" as string]: 10 }}>
        <div className="ad-panel-head">
          <div className="ad-panel-title"><h2>Most active teachers this period</h2><span className="ad-count">{mostActive.length}</span></div>
          <span className="ad-meta"><Link href="/admin/accounts">All accounts</Link></span>
        </div>
        {mostActive.length === 0 ? (
          <div className="ad-empty"><Users aria-hidden="true" /><span><strong>No teachers yet.</strong> Accounts appear here after the first sign-up.</span></div>
        ) : (
          <div className="ad-table-wrap">
          <table>
            <thead><tr><th>Teacher</th><th>Plan</th><th className="num">Scans</th><th className="num">Quota</th><th className="num">AI cost</th><th>Last seen</th><th aria-hidden="true"></th></tr></thead>
            <tbody>
              {mostActive.map((a) => {
                const pct = a.scan_quota ? Math.min(100, Math.round((a.scans_this_period / a.scan_quota) * 100)) : 0;
                return (
                  <tr key={a.teacher_id}>
                    <td><Link href={`/admin/accounts/${a.teacher_id}`}>{a.email}</Link></td>
                    <td>{a.plan_name}</td>
                    <td className="num">
                      {a.scans_this_period}
                      <div className={`ad-bar${pct >= 100 ? " bad" : pct >= 80 ? " warn" : ""}`}><span style={{ width: `${pct}%` }} /></div>
                    </td>
                    <td className="num">{a.scan_quota}</td>
                    <td className="num">{fmtUsd(a.ai_cost_this_period, 3)}</td>
                    <td className="muted">{fmtRel(a.last_seen_at)}</td>
                    <td className="num"><Link href={`/admin/accounts/${a.teacher_id}`} aria-label={`Open ${a.email}`}><ChevronRight className="ad-row-chev" aria-hidden="true" /></Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </section>
    </>
  );
}
