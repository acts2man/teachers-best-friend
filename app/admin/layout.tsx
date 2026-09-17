import Link from "next/link";
import { Fraunces, Atkinson_Hyperlegible } from "next/font/google";
import { ArrowLeft, LogOut } from "lucide-react";
import { requireAdmin } from "@/lib/admin-gate";
import { getPlatformStats } from "@/lib/supabase-admin";
import { AdminNav, type NavGroup } from "@/components/admin/admin-nav";
import "../tbf-tokens.css";

const fraunces = Fraunces({ subsets: ["latin"], axes: ["opsz", "SOFT"], variable: "--font-fraunces", display: "swap" });
const atkinson = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-atkinson", display: "swap" });

export const metadata = { title: "Admin — A Teacher's Best Friend", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/admin",           label: "Overview",           icon: "overview",  group: "Monitor" },
  { href: "/admin/usage",     label: "Usage & cost",       icon: "usage",     group: "Monitor" },
  { href: "/admin/accounts",  label: "Accounts",           icon: "accounts",  group: "Manage" },
  { href: "/admin/tickets",   label: "Tickets",            icon: "tickets",   group: "Manage", badge: "open_tickets" as const },
  { href: "/admin/library",   label: "Reteaching library", icon: "library",   group: "Manage", badge: "reteaching_unreviewed" as const },
  { href: "/admin/pipeline",  label: "AI pipeline",        icon: "pipeline",  group: "System" },
  { href: "/admin/standards", label: "Standards",          icon: "standards", group: "System" },
  { href: "/admin/audit",     label: "Audit log",          icon: "audit",     group: "System" },
] as const;

function initials(email: string) {
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._-]+/).filter(Boolean);
  const two = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return (two || "A").toUpperCase();
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const stats = await getPlatformStats().catch(() => null);

  const groups: NavGroup[] = ["Monitor", "Manage", "System"].map((label) => ({
    label,
    items: NAV.filter((n) => n.group === label).map((n) => ({
      href: n.href,
      label: n.label,
      icon: n.icon,
      count: "badge" in n && n.badge && stats ? stats[n.badge] : 0,
    })),
  }));

  return (
    <div className={`tbf admin ${fraunces.variable} ${atkinson.variable}`}>
      <div className="ad-shell">
        <aside className="ad-side">
          <div className="ad-side-top">
            <Link href="/admin" className="ad-brand">
              <span className="brand-mark">
                <img src="/brand/teacher-book.png" alt="" width="44" height="44" />
              </span>
              <span className="ad-brand-word">
                a teacher’s<strong>best friend.</strong>
              </span>
            </Link>
          </div>
          <AdminNav groups={groups} />
          <div className="ad-side-foot">
            <div className="ad-me" title={admin.email}>
              <span className="ad-avatar" aria-hidden="true">{initials(admin.email)}</span>
              <span style={{ minWidth: 0 }}>
                <span className="ad-me-email">{admin.email}</span>
                <span className="ad-me-role" style={{ display: "block" }}>Administrator</span>
              </span>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <Link href="/app" className="ad-back"><ArrowLeft aria-hidden="true" />Back to app</Link>
              <form action="/auth/signout" method="post" style={{ margin: 0 }}>
                <button type="submit" className="ad-back"><LogOut aria-hidden="true" />Sign out</button>
              </form>
            </div>
          </div>
        </aside>
        <main className="ad-main">{children}</main>
      </div>
    </div>
  );
}
