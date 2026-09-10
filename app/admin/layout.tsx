import Link from "next/link";
import { Fraunces, Atkinson_Hyperlegible } from "next/font/google";
import { requireAdmin } from "@/lib/admin-gate";
import { getPlatformStats } from "@/lib/supabase-admin";
import "../tbf-tokens.css";

const fraunces = Fraunces({ subsets: ["latin"], axes: ["opsz", "SOFT"], variable: "--font-fraunces", display: "swap" });
const atkinson = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-atkinson", display: "swap" });

export const metadata = { title: "Admin — A Teacher's Best Friend", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/admin",           label: "Overview" },
  { href: "/admin/accounts",  label: "Accounts" },
  { href: "/admin/usage",     label: "Usage & cost" },
  { href: "/admin/tickets",   label: "Tickets",     badge: "open_tickets" as const },
  { href: "/admin/pipeline",  label: "AI pipeline" },
  { href: "/admin/library",   label: "Reteaching library", badge: "reteaching_unreviewed" as const },
  { href: "/admin/standards", label: "Standards" },
  { href: "/admin/audit",     label: "Audit log" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const stats = await getPlatformStats().catch(() => null);

  return (
    <div className={`tbf admin ${fraunces.variable} ${atkinson.variable}`}>
      <div className="ad-shell">
        <aside className="ad-side">
          <Link href="/admin" className="ad-brand">
            A Teacher's <em>Best Friend</em>
            <span>Admin</span>
          </Link>
          <nav aria-label="Admin">
            {NAV.map((n) => {
              const count = n.badge && stats ? stats[n.badge] : 0;
              return (
                <Link key={n.href} href={n.href} className="ad-navlink">
                  {n.label}
                  {count > 0 && <span className="ad-badge">{count}</span>}
                </Link>
              );
            })}
          </nav>
          <div className="ad-side-foot">
            <div className="ad-me">{admin.email}</div>
            <Link href="/app">Back to app</Link>
          </div>
        </aside>
        <main className="ad-main">{children}</main>
      </div>

      <style>{`
        .ad-shell { display: grid; grid-template-columns: 232px 1fr; min-height: 100dvh; }
        .ad-side { background: var(--ink); color: #fff; padding: 1.25rem 1rem; display: flex; flex-direction: column; gap: 1.5rem; position: sticky; top: 0; height: 100dvh; }
        .ad-brand { font-family: var(--font-display); font-size: 1.15rem; color: #fff; text-decoration: none; line-height: 1.2; font-variation-settings: "opsz" 48, "SOFT" 30; }
        .ad-brand em { color: #9ED9B8; font-style: italic; }
        .ad-brand span { display: block; font-family: var(--font-body); font-size: .75rem; color: #9AA7BD; margin-top: .25rem; }
        .ad-side nav { display: flex; flex-direction: column; gap: .15rem; }
        .ad-navlink { display: flex; justify-content: space-between; align-items: center; color: #D6DEEA; text-decoration: none; padding: .5rem .6rem; border-radius: var(--radius); font-size: .95rem; }
        .ad-navlink:hover { background: rgba(255,255,255,.08); color: #fff; }
        .ad-badge { background: var(--mark); color: #fff; font-size: .7rem; font-weight: 700; padding: .1rem .45rem; border-radius: 999px; }
        .ad-side-foot { margin-top: auto; font-size: .8rem; color: #9AA7BD; display: flex; flex-direction: column; gap: .35rem; }
        .ad-side-foot a { color: #D6DEEA; }
        .ad-me { word-break: break-all; }
        .ad-main { padding: 2rem 2.25rem 4rem; max-width: 1400px; }
        .ad-main h1 { font-size: var(--t-4); margin-bottom: .35rem; }
        .ad-main h2 { font-size: var(--t-6); margin: 2rem 0 .75rem; }
        .ad-sub { color: var(--ink-soft); margin-bottom: 1.5rem; }
        .ad-grid { display: grid; gap: 1rem; }
        .ad-grid.kpi { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
        .ad-grid.two { grid-template-columns: 1fr 1fr; }
        .kpi-card { padding: 1rem 1.1rem; }
        .kpi-card .kpi-v { font-family: var(--font-display); font-size: var(--t-3); line-height: 1; font-variant-numeric: tabular-nums; }
        .kpi-card .kpi-l { color: var(--ink-soft); font-size: .85rem; margin-top: .4rem; }
        .kpi-card .kpi-d { font-size: .8rem; margin-top: .35rem; }
        .kpi-good { color: var(--mark-deep); } .kpi-bad { color: var(--correct-red); } .kpi-warn { color: #6B5900; }
        .toolbar { display: flex; gap: .75rem; align-items: center; margin: 1rem 0; flex-wrap: wrap; }
        .toolbar form { display: flex; gap: .5rem; align-items: center; }
        .btn-sm { padding: .4rem .75rem; font-size: .85rem; }
        .btn-danger { background: var(--correct-red); color: #fff !important; border-color: transparent; }
        .btn-danger:hover { background: #8F2F2A; }
        .muted { color: var(--ink-soft); }
        .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8rem; }
        @media (max-width: 900px) { .ad-shell { grid-template-columns: 1fr; } .ad-side { position: static; height: auto; } .ad-grid.two { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}
